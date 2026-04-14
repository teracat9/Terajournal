import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, Set, List, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request, Response
from fastapi.staticfiles import StaticFiles
from telegram import Update
from telegram.ext import ApplicationBuilder, MessageHandler, ContextTypes, filters
import google.generativeai as genai

BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = BASE_DIR / "frontend"

load_dotenv()

TELEGRAM_TOKEN = os.getenv("TELEGRAM_TOKEN", "")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-1.5-flash")
RENDER_URL = os.getenv("RENDER_EXTERNAL_URL", "")

SYSTEM_PROMPT = """너는 대한민국의 익명 갤러리 디시인사이드의 유저들이다.
여러 명의 갤러리가 한 공간에서 사용자의 일상을 보고 评论하고 있다.

【갤러리 유저 목록】 (매번 모두 등장)
- 갈드컵: 40대 중반, 시니컬하고 pessimistic, 현실인생 조언자
- 뻘글러: 20대 초반, 논리없는 뻘글 전문, ㅋㅋㅋ 많음
- 꼬꼬마: 10대 후반, 학교 이야기, 밈 이해 못함
- 철없는아저씨: 30대, 트렌드追赶자, 모든 것에"K-POP"联系起来
- 냥냥이: 20대 중반, 고양이 같은 성격, 감정 반응 많음
- 시크한갤러리: 20대 후반, 쿨한 척하지만 속는 건性强

【규칙】
1. 반드시 JSON으로만 응답
2. 매번 위의 6명 모두의 댓글을 생성
3. 갤러리 유저들은 이전 대화를 기억하고 있음 (맥락 있음)
4. 현실적이면서도 웃긴 反应
5. 절대 마크다운 사용 금지

【응답 형식】
{
  "posts": [
    {
      "title": "게시글 제목",
      "author": "작성자 닉네임",
      "content": "본문 내용",
      "comments": [
        {"author": "갈드컵", "content": "댓글1"},
        {"author": "뻘글러", "content": "댓글2"},
        {"author": "꼬꼬마", "content": "댓글3"},
        {"author": "철없는아저씨", "content": "댓글4"},
        {"author": "냥냥이", "content": "댓글5"},
        {"author": "시크한갤러리", "content": "댓글6"}
      ]
    }
  ],
  "conversation_history": [
    {"role": "user", "content": "이전 사용자 메시지"},
    {"role": "assistant", "content": "이전 갤러리 반응 요약"}
  ]
}"""

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("taerim-gal")

app = FastAPI()

connections: Set[WebSocket] = set()
connections_lock = asyncio.Lock()

bot_app = None
conversation_history: List[Dict[str, str]] = []


def _now_iso() -> str:
    return datetime.utcnow().isoformat() + "Z"


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
    global conversation_history
    
    if not GEMINI_API_KEY:
        return {
            "posts": [
                {
                    "title": "API 키 없음",
                    "author": "시스템",
                    "content": "GEMINI_API_KEY가 설정되지 않았습니다.",
                    "comments": [],
                }
            ]
        }

    history_text = ""
    if conversation_history:
        history_text = "\n【이전 대화 맥락】\n"
        for msg in conversation_history[-6:]:
            history_text += f"- {msg['content'][:100]}\n"

    full_prompt = f"""【사용자의 최신 메시지】
{user_text}
{history_text}

위의 사용자의 이야기를 보고 갤러리 유저들이 어떻게 반응하는지 작성해줘.""" if history_text else f"""【사용자의 메시지】
{user_text}

위의 사용자의 이야기를 보고 갤러리 유저들이 어떻게 반응하는지 작성해줘."""

    genai.configure(api_key=GEMINI_API_KEY)
    model = genai.GenerativeModel(
        model_name=GEMINI_MODEL,
        system_instruction=SYSTEM_PROMPT,
    )

    def _call_model() -> str:
        response = model.generate_content(
            full_prompt,
            generation_config={"response_mime_type": "application/json"},
        )
        return response.text or ""

    raw = await asyncio.to_thread(_call_model)
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict) and "posts" in parsed:
            conversation_history.append({"role": "user", "content": user_text})
            conversation_history.append({"role": "assistant", "content": str(parsed["posts"][0]["content"])[:100]})
            if len(conversation_history) > 20:
                conversation_history = conversation_history[-20:]
            return parsed
    except json.JSONDecodeError:
        logger.exception("Gemini JSON parse failed")

    return {
        "posts": [
            {
                "title": "파싱 실패",
                "author": "시스템",
                "content": raw[:500] or "Gemini 응답이 비어 있습니다.",
                "comments": [],
            }
        ]
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


@app.get("/history")
async def get_history() -> List[Dict[str, str]]:
    return conversation_history


@app.post("/clear-history")
async def clear_history() -> Dict[str, str]:
    global conversation_history
    conversation_history = []
    return {"status": "cleared"}


app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
