import asyncio
import json
import logging
import os
import random
import sqlite3
import base64
import json as json_lib
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, Any, Set, List, Optional
from uuid import uuid4

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request, Response
from fastapi.staticfiles import StaticFiles
from telegram import Update
from telegram.ext import ApplicationBuilder, MessageHandler, ContextTypes, filters
from google import genai

BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = BASE_DIR / "frontend"
DB_PATH = BASE_DIR / "data.db"

load_dotenv()

TELEGRAM_TOKEN = os.getenv("TELEGRAM_TOKEN", "")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash-preview-05-20")
RENDER_URL = os.getenv("RENDER_EXTERNAL_URL", "")
AGG_WINDOW_MINUTES = int(os.getenv("AGG_WINDOW_MINUTES", "30"))

client = genai.Client(api_key=GEMINI_API_KEY, http_options={'api_version': 'v1'}) if GEMINI_API_KEY else None

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("taerim-gal")

app = FastAPI()

connections: Set[WebSocket] = set()
connections_lock = asyncio.Lock()

bot_app = None
bot_started = False
saved_posts: List[Dict[str, Any]] = []
user_chronicle: List[Dict[str, str]] = []
gallery_chronicle: List[Dict[str, str]] = []

GODLIFE_KEYWORDS = ["코딩", "운동", "독서", "공부", "작업", "개발", "루틴", "산책", "수영", "헬스", "스트레칭"]
LAZY_KEYWORDS = ["야식", "늦잠", "게임", "무기력", "눕", "멍", "침대", "넷플", "피곤"]


def init_db():
    conn = sqlite3.connect(str(DB_PATH))
    c = conn.cursor()
    c.execute("""
        CREATE TABLE IF NOT EXISTS events (
            id TEXT PRIMARY KEY,
            event_start TEXT,
            event_end TEXT,
            message_count INTEGER,
            mood TEXT,
            event_title TEXT,
            data TEXT
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS chronicles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT,
            content TEXT,
            time TEXT
        )
    """)
    conn.commit()
    conn.close()


def save_event_to_db(event: Dict[str, Any]):
    conn = sqlite3.connect(str(DB_PATH))
    c = conn.cursor()
    data_json = json_lib.dumps(event)
    c.execute("""
        INSERT OR REPLACE INTO events (id, event_start, event_end, message_count, mood, event_title, data)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (
        event.get("event_id"),
        event.get("event_start"),
        event.get("event_end"),
        event.get("message_count", 1),
        event.get("mood", "NEUTRAL"),
        event.get("event_title"),
        data_json
    ))
    conn.commit()
    conn.close()


def save_chronicle_to_db(chronicle_type: str, content: str, time_iso: str):
    conn = sqlite3.connect(str(DB_PATH))
    c = conn.cursor()
    c.execute("INSERT INTO chronicles (type, content, time) VALUES (?, ?, ?)", (chronicle_type, content, time_iso))
    conn.commit()
    conn.close()


def load_all_from_db():
    global saved_posts, user_chronicle, gallery_chronicle
    
    conn = sqlite3.connect(str(DB_PATH))
    c = conn.cursor()
    
    c.execute("SELECT data FROM events ORDER BY event_start DESC LIMIT 100")
    rows = c.fetchall()
    saved_posts = [json_lib.loads(row[0]) for row in rows] if rows else []
    
    c.execute("SELECT type, content, time FROM chronicles WHERE type='user' ORDER BY id DESC LIMIT 50")
    user_rows = c.fetchall()
    user_chronicle = [{"content": r[1], "time": r[2]} for r in user_rows] if user_rows else []
    
    c.execute("SELECT type, content, time FROM chronicles WHERE type='gallery' ORDER BY id DESC LIMIT 50")
    gallery_rows = c.fetchall()
    gallery_chronicle = [{"content": r[1], "time": r[2]} for r in gallery_rows] if gallery_rows else []
    
    conn.close()


def _now_iso() -> str:
    return datetime.utcnow().isoformat() + "Z"

def _parse_iso(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", ""))

def _classify_text(text: str) -> str:
    content = (text or "").lower()
    is_god = any(keyword in content for keyword in GODLIFE_KEYWORDS)
    is_lazy = any(keyword in content for keyword in LAZY_KEYWORDS)
    if is_god and not is_lazy:
        return "GODLIFE"
    if is_lazy and not is_god:
        return "LAZY"
    return "NEUTRAL"

def _merge_mood(current: str, incoming: str) -> str:
    if "GODLIFE" in (current, incoming):
        return "GODLIFE"
    if "LAZY" in (current, incoming):
        return "LAZY"
    return "NEUTRAL"

def _make_event_title(summary: str) -> str:
    base = (summary or "").strip()
    if not base:
        return "브이로그 세션"
    return base[:24]

def generate_anonymous_name() -> str:
    ip = f"{random.randint(1,999)}.{random.randint(0,99)}"
    return f"ㅇㅇ({ip})"


def build_system_prompt(has_image: bool = False, image_description: str = "") -> str:
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

    image_context = f"\n\n【사용자가 보낸 사진】\n{image_description}" if has_image else ""

    return f"""너는 유튜브 브이로그 라이브의 따뜻한 시청자들이다.
매번 6-10명의 시청자가 채팅으로 응원과 공감을 남긴다.

【닉네임 규칙】
- 실제 유튜브 채팅 스타일: 짧고 귀여운 닉네임 (예: 민초단, 하루루, 연두, 소담, 밤비)
- 공격적/비하 금지, 산뜻하고 긍정적인 톤 유지

【시청자 성격 (매번 랜덤하게 섞어서 배정)】
- 응원러: 힘내요/멋져요 위주
- 공감러: "나도 그래요" 톤
- 루틴러: 건강/루틴 팁 공유
- 감성러: 잔잔한 감성 코멘트
- 체크리스트러: 오늘 한 일 요약/정리

【핵심 규칙】
1. JSON으로만 응답
2. 댓글은 서로 친근하게 이어짐 (싸움/욕설 금지)
3. 갤러리 연대기와 사용자 연대기를 참고해서 맥락 유지
4. 절대 마크다운 사용 금지
5. 본문은 짧고 담백하게
6. 사진이 있으면 사진 내용을 구체적으로 언급하며 반응{user_summary}{gallery_summary}{image_context}

【응답 형식】
{{
  "posts": [
    {{
      "title": "짧고 산뜻한 제목",
      "author": "닉네임",
      "content": "브이로그 톤의 짧은 본문 (2-3줄)",
      "comments": [
        {{"author": "민초단", "content": "오늘 루틴 너무 좋다"}},
        {{"author": "소담", "content": "차분하게 잘 했네요"}},
        {{"author": "밤비", "content": "이 분위기 좋아요"}},
        {{"author": "하루루", "content": "내일도 같이 가요"}}
      ]
    }}
  ],
  "user_summary": "이번 사용자 메시지를 한 줄 요약 (AI가 기억용)",
  "gallery_summary": "이번 시청자 반응을 한 줄 요약 (AI가 기억용)"
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

def _fallback_posts(message: str) -> Dict[str, Any]:
    return {
        "posts": [{"title": "AI 대기중", "author": "시스템", "content": message, "comments": []}],
        "user_summary": "",
        "gallery_summary": ""
    }


async def generate_gallery_posts(
    user_text: str, 
    image_data: Optional[bytes] = None,
    image_description: str = ""
) -> Dict[str, Any]:
    global user_chronicle, gallery_chronicle

    if not client:
        return _fallback_posts("GEMINI_API_KEY가 설정되지 않았습니다.")

    system_prompt = build_system_prompt(has_image=bool(image_data), image_description=image_description)

    if image_data:
        full_prompt = f"""{system_prompt}

【사용자의 오늘 일기/메시지】
{user_text if user_text else "사진만 보냈습니다."}

위의 내용을 보고 시청자들이 실시간으로 반응해줘."""
    else:
        full_prompt = f"""{system_prompt}

【사용자의 오늘 일기/메시지】
{user_text}

위의 글을 보고 갤러리 유저들이 실시간으로 싸우며 반응해줘."""

    def _call_model() -> str:
        if image_data:
            response = client.models.generate_content(
                model=GEMINI_MODEL,
                contents=[
                    {"text": full_prompt},
                    {"inline_data": {"mime_type": "image/jpeg", "data": base64.b64encode(image_data).decode()}}
                ],
            )
        else:
            response = client.models.generate_content(
                model=GEMINI_MODEL,
                contents=full_prompt,
            )
        return response.text or ""

    raw = ""
    max_retries = 10
    base_delay = 1
    
    for attempt in range(max_retries):
        try:
            raw = await asyncio.to_thread(_call_model)
            break
        except Exception as exc:
            logger.warning("Gemini call failed (%s/%s): %s", attempt + 1, max_retries, exc)
            if attempt < max_retries - 1:
                delay = min(base_delay * (2 ** attempt), 8)
                logger.info(f"Retrying in {delay}s...")
                await asyncio.sleep(delay)
                continue
            return _fallback_posts(f"AI가 계속 실패하고 있어요... 나중에 다시 시도해주세요. ({attempt + 1}회 시도)")
    
    try:
        parsed = json_lib.loads(raw)
        if isinstance(parsed, dict) and "posts" in parsed:
            user_summary = parsed.get("user_summary", user_text[:50] if user_text else "사진 전송")
            gallery_summary = parsed.get("gallery_summary", str(parsed["posts"][0]["content"])[:50])

            user_chronicle.append({"content": user_summary, "time": _now_iso()})
            gallery_chronicle.append({"content": gallery_summary, "time": _now_iso()})
            
            save_chronicle_to_db("user", user_summary, _now_iso())
            save_chronicle_to_db("gallery", gallery_summary, _now_iso())

            if len(user_chronicle) > 50:
                user_chronicle = user_chronicle[-50:]
            if len(gallery_chronicle) > 50:
                gallery_chronicle = gallery_chronicle[-50:]

            mood = _classify_text(user_text) if user_text else "NEUTRAL"
            parsed["mood"] = mood
            parsed["event_title"] = _make_event_title(user_summary)
            return parsed
    except json_lib.JSONDecodeError:
        logger.exception("Gemini JSON parse failed")

    return {
        "posts": [{"title": "파싱 실패", "author": "시스템", "content": raw[:500], "comments": []}],
        "user_summary": "",
        "gallery_summary": ""
    }

def _upsert_event(data: Dict[str, Any], now_iso: str) -> Dict[str, Any]:
    if not saved_posts:
        event_id = str(uuid4())
        event = {
            "event_id": event_id,
            "event_start": now_iso,
            "event_end": now_iso,
            "message_count": 1,
            "mood": data.get("mood", "NEUTRAL"),
            "event_title": data.get("event_title") or _make_event_title(data.get("user_summary", "")),
            **data,
        }
        save_event_to_db(event)
        return event

    last = saved_posts[-1]
    try:
        last_end = _parse_iso(last.get("event_end", now_iso))
        now_dt = _parse_iso(now_iso)
    except Exception:
        last_end = _parse_iso(now_iso)
        now_dt = _parse_iso(now_iso)

    if now_dt - last_end <= timedelta(minutes=AGG_WINDOW_MINUTES):
        last["posts"] = (last.get("posts") or []) + (data.get("posts") or [])
        last["user_summary"] = data.get("user_summary", last.get("user_summary", ""))
        last["gallery_summary"] = data.get("gallery_summary", last.get("gallery_summary", ""))
        last["event_end"] = now_iso
        last["message_count"] = int(last.get("message_count", 1)) + 1
        last["mood"] = _merge_mood(last.get("mood", "NEUTRAL"), data.get("mood", "NEUTRAL"))
        last["event_title"] = data.get("event_title") or last.get("event_title")
        save_event_to_db(last)
        return last

    event_id = str(uuid4())
    event = {
        "event_id": event_id,
        "event_start": now_iso,
        "event_end": now_iso,
        "message_count": 1,
        "mood": data.get("mood", "NEUTRAL"),
        "event_title": data.get("event_title") or _make_event_title(data.get("user_summary", "")),
        **data,
    }
    save_event_to_db(event)
    return event


async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    text = ""
    image_data = None
    image_description = ""
    
    if update.message:
        if update.message.text:
            text = update.message.text.strip()
        elif update.message.caption:
            text = update.message.caption.strip()
        elif update.message.photo:
            photo = update.message.photo[-1]
            try:
                file = await context.bot.get_file(photo.file_id)
                image_bytes = await file.download_as_bytearray()
                image_data = bytes(image_bytes)
                text = "사용자가 사진을 보냈습니다."
            except Exception as e:
                logger.error(f"Failed to download photo: {e}")
                text = "사용자가 사진을 보냈습니다. (사진 다운로드 실패)"

    if not text and not image_data:
        return

    data = await generate_gallery_posts(text, image_data, image_description)
    now_iso = _now_iso()

    # AI가 시스템(에러) 응답이면 화면에만 알림만 띄우고 기록 저장 안 함
    if data.get("posts") and data["posts"][0].get("author") == "시스템":
        dummy_event = {
            "event_id": "temp-" + str(uuid4()),
            "event_title": "알림",
            **data
        }
        payload = _build_payload(dummy_event)
        await broadcast(payload)
        return

    # 정상 응답만 저장
    event = _upsert_event(data, now_iso)
    payload = _build_payload(event)
    await broadcast(payload)
    if not saved_posts or saved_posts[-1].get("event_id") != event.get("event_id"):
        saved_posts.insert(0, event)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global bot_app, bot_started
    
    init_db()
    load_all_from_db()
    
    if TELEGRAM_TOKEN and RENDER_URL:
        bot_app = ApplicationBuilder().token(TELEGRAM_TOKEN).build()
        bot_app.add_handler(MessageHandler(filters.TEXT | filters.PHOTO, handle_message))
        await bot_app.initialize()
        webhook_url = f"{RENDER_URL}/webhook/{TELEGRAM_TOKEN}"
        await bot_app.bot.set_webhook(webhook_url)
        logger.info(f"Webhook set to {webhook_url}")
        bot_started = False
    elif TELEGRAM_TOKEN:
        logger.warning("RENDER_EXTERNAL_URL not set. Using polling mode.")
        bot_app = ApplicationBuilder().token(TELEGRAM_TOKEN).build()
        bot_app.add_handler(MessageHandler(filters.TEXT | filters.PHOTO, handle_message))
        await bot_app.initialize()
        await bot_app.start()
        await bot_app.updater.start_polling()
        bot_started = True
    yield
    if bot_app:
        if bot_started:
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


@app.get("/favicon.ico")
async def favicon() -> Response:
    return Response(status_code=204)


@app.get("/posts")
async def get_posts() -> List[Dict[str, Any]]:
    return saved_posts


@app.get("/chronicles")
async def get_chronicles() -> Dict[str, List[Dict[str, str]]]:
    return {"user": user_chronicle, "gallery": gallery_chronicle}


@app.post("/clear-posts")
async def clear_posts() -> Dict[str, str]:
    global saved_posts
    conn = sqlite3.connect(str(DB_PATH))
    c = conn.cursor()
    c.execute("DELETE FROM events")
    conn.commit()
    conn.close()
    saved_posts = []
    return {"status": "cleared"}


@app.post("/clear-chronicles")
async def clear_chronicles() -> Dict[str, str]:
    global user_chronicle, gallery_chronicle
    conn = sqlite3.connect(str(DB_PATH))
    c = conn.cursor()
    c.execute("DELETE FROM chronicles")
    conn.commit()
    conn.close()
    user_chronicle = []
    gallery_chronicle = []
    return {"status": "cleared"}


app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
