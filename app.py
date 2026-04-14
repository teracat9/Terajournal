import asyncio
import json
import logging
import os
import random
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, Set, List

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request, Response
from fastapi.staticfiles import StaticFiles
from telegram import Update
from telegram.ext import ApplicationBuilder, MessageHandler, ContextTypes, filters
from google import genai

BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = BASE_DIR / "frontend"

load_dotenv()

TELEGRAM_TOKEN = os.getenv("TELEGRAM_TOKEN", "")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.1-flash")
RENDER_URL = os.getenv("RENDER_EXTERNAL_URL", "")

client = genai.Client(api_key=GEMINI_API_KEY, http_options={'api_version': 'v1'}) if GEMINI_API_KEY else None

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("taerim-gal")

app = FastAPI()

connections: Set[WebSocket] = set()
connections_lock = asyncio.Lock()

bot_app = None
saved_posts: List[Dict[str, Any]] = []
user_chronicle: List[Dict[str, str]] = []
gallery_chronicle: List[Dict[str, str]] = []


def _now_iso() -> str:
    return datetime.utcnow().isoformat() + "Z"


def generate_anonymous_name() -> str:
    ip = f"{random.randint(1,999)}.{random.randint(0,99)}"
    return f"ㅇㅇ({ip})"


def build_system_prompt() -> str:
    user_summary = ""
    if user_chronicle:
        user_summary = "\n\n【사용자 연대기】\n"
        for item in user_chronicle[-10:]:
            user_summary += f"- {item['content']}\n"

    gallery_summary = ""
    if gallery_chronicle:
        gallery_summary = "\n\n【갤러리 연대기】\n"
        for item in gallery_chronicle[-10:]:
            gallery_summary += f"- {item['content']}\n"

    return f"""너는 대한민국 익명 갤러리 디시인사이드의 유저들이다.
매번 8-12명의 익명 갤러러들이 댓글을 달며 실시간으로 싸우고 상호작용한다.

【익명 닉네임 생성 규칙】
- 모두 ㅇㅇ로固定 (예: ㅇㅇ(132.48), ㅇㅇ(92.15), ㅇㅇ(248.3))
- 예시: ㅇㅇ(132.48), ㅇㅇ(92.15), ㅇㅇ(248.3), ㅇㅇ(15.77)

【갤러리 유저 성격 (매번 랜덤하게 섞어서 배정)】
- 현실까: 현실적인 반박, 인생 경험으로 조언
- 뻘글러: 논리 없이 웃긴 말, ㅋㅋㅋ 폭발
- 꼬꼬마: 순수한 반응, 밈 잘못 이해
- 트렌드추격자: 최신 밈, 유행어 남발
- 감성러: 감정적 반응, ㅠㅠ 많음
- 시크댓글러: 쿨한 척, 속는 건 마찬가지
- 고인: 옛날 밈, "요즘은 이게 뜨거움" 스타일
- 냥냥이: 고양이 사진 언급, 귀여움 반응

【핵심 규칙】
1. JSON으로만 응답
2. 각 댓글은 다른 유저가 서로의 댓글에 반응하며 싸움
3. 첫 댓글 → 다른 유저가 반박 → 첫 유저가 역反박 → 또 다른 유저 개입... (연속 댓글战争中)
4. 갤러리 연대기와 사용자 연대기를 참고해서 맥락 유지
5. 절대 마크다운 사용 금지
6. 본문은 짧고 임팩트 있게

{user_summary}{gallery_summary}

【응답 형식】
{{
  "posts": [
    {{
      "title": "짧고 임팩트 있는 제목",
      "author": "익명 닉네임",
      "content": "짧고 센싶은 본문 (2-3줄)",
      "comments": [
        {{"author": "ㅇㅇ(1523)", "content": "첫 반응"}},
        {{"author": "ㅎㅎ(998)", "content": "첫 유저 반박/비웃음"}},
        {{"author": "ㅇㅇ(1523)", "content": "역反박"}},
        {{"author": "익(42)", "content": "새 유저 개입"}},
        {{"author": "ㅎㅎ(998)", "content": "꼬꼬마 놀리기 시작"}},
        {{"author": "ㄱㄱ(7721)", "content": "트렌드유행"}},
        {{"author": "ㅎㅎ(998)", "content": "마지막 한마디"}}
      ]
    }}
  ],
  "user_summary": "이번 사용자 메시지를 한 줄 요약 (AI가 기억용)",
  "gallery_summary": "이번 갤러리 반응을 한 줄 요약 (AI가 기억용)"
}}"""


async def broadcast(payload: Dict[str, Any]) -> None:
    dead = []
    async with connections_lock:
        for ws in connections:
            try:
                await ws.send_text(json.dumps(payload, ensure_ascii=False))
            except Exception:
                dead.append(ws)
        for ws in dead:
            connections.discard(ws)


def _build_payload(data: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "type": "new_posts",
        "received_at": _now_iso(),
        "data": data,
    }


async def generate_gallery_posts(user_text: str) -> Dict[str, Any]:
    global user_chronicle, gallery_chronicle

    if not client:
        return {
            "posts": [{"title": "API 키 없음", "author": "시스템", "content": "GEMINI_API_KEY가 설정되지 않았습니다.", "comments": []}],
            "user_summary": "",
            "gallery_summary": ""
        }

    system_prompt = build_system_prompt()

    full_prompt = f"""【사용자의 오늘 일기/메시지】
{user_text}

위의 글을 보고 갤러리 유저들이 실시간으로 싸우며 반응해줘."""

    def _call_model() -> str:
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=full_prompt,
            config={'system_instruction': system_prompt, 'response_mime_type': 'application/json'}
        )
        return response.text or ""

    raw = await asyncio.to_thread(_call_model)
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict) and "posts" in parsed:
            user_summary = parsed.get("user_summary", user_text[:50])
            gallery_summary = parsed.get("gallery_summary", str(parsed["posts"][0]["content"])[:50])

            user_chronicle.append({"content": user_summary, "time": _now_iso()})
            gallery_chronicle.append({"content": gallery_summary, "time": _now_iso()})

            if len(user_chronicle) > 50:
                user_chronicle = user_chronicle[-50:]
            if len(gallery_chronicle) > 50:
                gallery_chronicle = gallery_chronicle[-50:]

            return parsed
    except json.JSONDecodeError:
        logger.exception("Gemini JSON parse failed")

    return {
        "posts": [{"title": "파싱 실패", "author": "시스템", "content": raw[:500], "comments": []}],
        "user_summary": "",
        "gallery_summary": ""
    }


async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    text = ""
    if update.message:
        if update.message.text:
            text = update.message.text.strip()
        elif update.message.caption:
            text = update.message.caption.strip()
        elif update.message.photo:
            text = "사용자가 사진을 보냈습니다."

    if not text:
        return

    data = await generate_gallery_posts(text)
    payload = _build_payload(data)
    await broadcast(payload)
    saved_posts.append(data)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global bot_app
    if TELEGRAM_TOKEN and RENDER_URL:
        bot_app = ApplicationBuilder().token(TELEGRAM_TOKEN).build()
        bot_app.add_handler(MessageHandler(filters.TEXT | filters.PHOTO, handle_message))
        await bot_app.initialize()
        webhook_url = f"{RENDER_URL}/webhook/{TELEGRAM_TOKEN}"
        await bot_app.bot.set_webhook(webhook_url)
        logger.info(f"Webhook set to {webhook_url}")
    elif TELEGRAM_TOKEN:
        logger.warning("RENDER_EXTERNAL_URL not set. Using polling mode.")
        bot_app = ApplicationBuilder().token(TELEGRAM_TOKEN).build()
        bot_app.add_handler(MessageHandler(filters.TEXT | filters.PHOTO, handle_message))
        await bot_app.initialize()
        await bot_app.start()
        await bot_app.updater.start_polling()
    yield
    if bot_app:
        await bot_app.stop()
        await bot_app.shutdown()


app = FastAPI(lifespan=lifespan)


@app.post("/webhook/{token}")
async def webhook(token: str, request: Request):
    global bot_app
    if token != TELEGRAM_TOKEN:
        return Response(status_code=403)
    if not bot_app:
        return Response(status_code=500)
    data = await request.json()
    update = Update.de_json(data, bot_app.bot)
    await bot_app.process_update(update)
    return Response(status_code=200)


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket) -> None:
    await ws.accept()
    async with connections_lock:
        connections.add(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        async with connections_lock:
            connections.discard(ws)


@app.get("/health")
async def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.get("/posts")
async def get_posts() -> List[Dict[str, Any]]:
    return saved_posts


@app.get("/chronicles")
async def get_chronicles() -> Dict[str, List[Dict[str, str]]]:
    return {"user": user_chronicle, "gallery": gallery_chronicle}


@app.post("/clear-posts")
async def clear_posts() -> Dict[str, str]:
    global saved_posts
    saved_posts = []
    return {"status": "cleared"}


@app.post("/clear-chronicles")
async def clear_chronicles() -> Dict[str, str]:
    global user_chronicle, gallery_chronicle
    user_chronicle = []
    gallery_chronicle = []
    return {"status": "cleared"}


app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
