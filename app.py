import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, Set

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

SYSTEM_PROMPT = (
    "너는 디시인사이드 생태계와 밈을 완벽히 이해한 AI다. "
    "사용자의 일상을 입력받으면, 이를 관찰하는 갤러리 유저들 또는 사용자의 머릿속 자아들(인사이드 아웃 컨셉)이 "
    "작성한 가상의 게시글과 댓글을 생성해라. 적나라하고 날것의 뻘글, 훈수, 분탕, 갈드컵 느낌을 살려라. "
    "반드시 JSON으로만 응답하라. 포맷: {\"posts\":[{\"title\":\"...\",\"author\":\"...\",\"content\":\"...\",\"comments\":[{\"author\":\"...\",\"content\":\"...\"}]}]}"
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("taerim-gal")

app = FastAPI()

connections: Set[WebSocket] = set()
connections_lock = asyncio.Lock()

bot_app = None


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


async def generate_gemini_json(user_text: str) -> Dict[str, Any]:
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

    genai.configure(api_key=GEMINI_API_KEY)
    model = genai.GenerativeModel(
        model_name=GEMINI_MODEL,
        system_instruction=SYSTEM_PROMPT,
    )

    def _call_model() -> str:
        response = model.generate_content(
            user_text,
            generation_config={"response_mime_type": "application/json"},
        )
        return response.text or ""

    raw = await asyncio.to_thread(_call_model)
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict) and "posts" in parsed:
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
            text = "사용자가 사진을 보냈습니다. 사진에 대한 반응을 작성해라."

    if not text:
        return

    data = await generate_gemini_json(text)
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


app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
