#!/usr/bin/env python3
"""
daily_reward.py — Full-HTTP "1 conversation CLI" per refresh token.

Resep (verified 2026-09-04, lihat re/CODEBUDDY_CLI_RE.md):
  1. POST /v2/plugin/auth/token/refresh   (X-Refresh-Token) -> accessToken + uid
  2. POST /v2/chat/completions            (system prompt + "hi", header CLI) -> SSE 200
  3. POST /v2/report                      (agent_task_created) -> 200
  4. (ops) POST /v2/billing/meter/get-user-resource -> cek TotalDosage

PENTING: messages[0] HARUS role "system" (kalau tidak -> 400 code 11128).

Usage:
  python3 daily_reward.py --file 9router_refresh.txt --workers 5
  python3 daily_reward.py --file 9router_refresh.txt --limit 3 --dry-run
  python3 daily_reward.py --file 9router_refresh.txt --workers 3 --retry 5   # auto-retry 429
"""
import argparse
import base64
import concurrent.futures as cf
import json
import random
import ssl
import sys
import threading
import time
import urllib.request
import urllib.error
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
CA = str(Path.home() / ".mitmproxy/mitmproxy-ca-cert.pem")

_print_lock = threading.Lock()


def log(msg, level="INFO"):
    """Level param diterima demi konsistensi dengan farm.py/farm_window.py
    (pemanggilan log(msg, "ERR") valid) — level tidak mengubah format output."""
    with _print_lock:
        print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def _opener(proxy=None):
    ctx = ssl.create_default_context()
    if Path(CA).exists():
        try:
            ctx.load_verify_locations(CA)
        except Exception:
            pass
    handlers = [urllib.request.HTTPSHandler(context=ctx)]
    if proxy:
        handlers.insert(0, urllib.request.ProxyHandler({"https": proxy, "http": proxy}))
    return urllib.request.build_opener(*handlers)


def _post(op, base, path, body, headers, timeout=60):
    r = urllib.request.Request(base + path, data=json.dumps(body).encode(), method="POST")
    for k, v in headers.items():
        r.add_header(k, v)
    try:
        with op.open(r, timeout=timeout) as resp:
            return resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        try:
            return e.code, e.read().decode("utf-8", "replace")
        except Exception:
            return e.code, ""
    except Exception as e:
        return -1, f"NETERR {e}"


def _decode_uid(access_token):
    try:
        p = access_token.split(".")[1]
        p += "=" * (-len(p) % 4)
        return json.loads(base64.urlsafe_b64decode(p)).get("sub", "")
    except Exception:
        return ""


def _base_for_refresh(refresh_token):
    """Realm dari issuer refresh token -> tentukan host + X-Domain."""
    try:
        p = refresh_token.split(".")[1]
        p += "=" * (-len(p) % 4)
        iss = json.loads(base64.urlsafe_b64decode(p)).get("iss", "")
    except Exception:
        iss = ""
    if "workbuddy" in iss:
        return "https://www.workbuddy.ai", "www.workbuddy.ai"
    return "https://www.codebuddy.ai", "www.codebuddy.ai"


# Identitas client yang di-spoof. CLI = CodeBuddy CLI; IDE = CodeBuddy IDE desktop;
# ide_full = headers + report lengkap hasil RE NodeService;
# ide_exact = REPLIKASI EXACT body chat IDE asli (system prompt 19.5KB + tools 26 +
# user_info + additional_data + user_query) hasil capture JSON.stringify inspector.
# Lihat re/CODEBUDDY_IDE_NODESERVICE_RE.md + re/captures_body/ (2026-09-04).
IDENTITIES = {
    "cli": {
        "ua": "CLI/2.143.1 CodeBuddy/2.143.1",
        "ide_name": "CLI", "ide_type": "CLI", "ide_version": "2.143.1",
    },
    "ide": {
        "ua": "CodeBuddyIDE/4.11.3",
        "ide_name": "CodeBuddyIDE", "ide_type": "CodeBuddyIDE", "ide_version": "4.11.3",
    },
    "ide_full": {
        "ua": "CodeBuddyIDE/4.11.3",
        "ide_name": "CodeBuddyIDE", "ide_type": "CodeBuddyIDE", "ide_version": "4.11.3",
        # Headers tambahan hasil capture IDE asli (generate-title + report)
        "x_product_version": "4.11.3",
        "x_env_id": "production",
        "x_private_data": "true",
        # Body report agent_task_created versi IDE (VERIFIED capture)
        "report_extra": {
            "has_repo": False, "repo_type": "none", "workspace_type": "empty",
            "has_connector": False, "connector_types": [],
            "has_mention": False, "mention_types": [],
            "has_template": False,
            "source": "LOCAL", "name": "working",
            "username": None, "userNickname": None,  # diisi runtime dari JWT
            "releaseDate": 1787843445604,
            "commit": "5c032d7a2aad11b6f8b15a746a842b93a5b41f99",
            "qimei36": "f2780ae4510cf7cc52615f4720001101a804",
            "arch": "arm64", "osVersion": "25.6.0",
            "cpuModel": "Apple M2 Pro", "cpuCores": 10, "memorySize": 16,
            "extName": "coding-copilot", "extVersion": "4.11.3",
            "machineId": "b62f6910-537c-4486-9302-98b44036bb44",
            "sessionId": None,  # diisi runtime (uuid4 per run)
            "vcsType": "unknown", "vcsRepo": "", "vcsBranchName": "", "vcsRevId": "",
        },
    },
    "ide_exact": {
        "ua": "CodeBuddyIDE/4.11.3",
        "ide_name": "CodeBuddyIDE", "ide_type": "CodeBuddyIDE", "ide_version": "4.11.3",
        "x_product_version": "4.11.3",
        "x_env_id": "production",
        "x_private_data": "true",
        # Exact body flag — load template dari re/captures_body/ide_exact_templates.json
        "exact_body": True,
        # Headers craft verified via Frida TLSWrap capture:
        "hex32_ids": True,          # X-Conversation-* pakai hex32 (bukan uuid4)
        "x_model_id": True,         # X-Model-ID: default-model
        "report_extra": {
            "has_repo": False, "repo_type": "none", "workspace_type": "empty",
            "has_connector": False, "connector_types": [],
            "has_mention": False, "mention_types": [],
            "has_template": False,
            "source": "LOCAL", "name": "working",
            "username": None, "userNickname": None,
            "releaseDate": 1787843445604,
            "commit": "5c032d7a2aad11b6f8b15a746a842b93a5b41f99",
            "qimei36": "f2780ae4510cf7cc52615f4720001101a804",
            "arch": "arm64", "osVersion": "25.6.0",
            "cpuModel": "Apple M2 Pro", "cpuCores": 10, "memorySize": 16,
            "extName": "coding-copilot", "extVersion": "4.11.3",
            "machineId": "b62f6910-537c-4486-9302-98b44036bb44",
            "sessionId": None,
            "vcsType": "unknown", "vcsRepo": "", "vcsBranchName": "", "vcsRevId": "",
        },
    },
    "cli_exact": {
        "ua": "CLI/2.144.0 CodeBuddy/2.144.0",
        "ide_name": "CLI", "ide_type": "CLI", "ide_version": "2.144.0",
        # Exact body CLI 2.144.0 (capture mitm 2026-09-05)
        "exact_body": "cli",
        # Headers CLI khas (verified wire capture)
        "x_stainless": True,        # x-stainless-* SDK headers
        "x_codebuddy_request": True,
        "root_request_id": True,     # X-Root-Request-ID + traceparent + b3
        "report_extra": {
            "reportDelay": 2000,
            "timezone": "Asia/Jakarta",
            "releaseDate": 1788530857503,
            "commit": "8d037fece0be1978272cf60f906f7bd144e32408",
            "arch": "arm64", "osVersion": "25.6.0",
            "cpuModel": "Apple M2 Pro", "cpuCores": 10, "memorySize": 16,
            "extName": "@tencent-ai/codebuddy-code", "extVersion": "2.144.0",
            "machineId": "0FE2FE60-FE66-564A-8DB9-95161C1ECE08",
            "sessionId": None,
            "featureModule": "cli_local",
            "vcsType": "unknown", "vcsRepo": "", "vcsBranchName": "", "vcsRevId": "",
        },
    },
}

# Template exact body IDE (lazy load)
_IDE_EXACT_TEMPLATES = None


def _load_ide_exact_templates():
    """Load system prompt + tools hasil capture body asli IDE."""
    global _IDE_EXACT_TEMPLATES
    if _IDE_EXACT_TEMPLATES is not None:
        return _IDE_EXACT_TEMPLATES
    path = HERE / "re" / "captures_body" / "ide_exact_templates.json"
    try:
        with open(path, encoding="utf-8") as f:
            _IDE_EXACT_TEMPLATES = json.load(f)
        log(f"[ide_exact] templates loaded: system={len(_IDE_EXACT_TEMPLATES['system_prompt'])} chars, tools={_IDE_EXACT_TEMPLATES['tools_count']}")
    except Exception as e:
        log(f"[ide_exact] template load gagal ({e}) — fallback ke body minimal", "ERR")
        _IDE_EXACT_TEMPLATES = {"system_prompt": None, "tools": None, "body_fields": {}}
    return _IDE_EXACT_TEMPLATES


# Template exact body CLI (lazy load)
_CLI_EXACT_TEMPLATES = None


def _load_cli_exact_templates():
    """Load system prompt + tools + user-blocks hasil capture CLI 2.144.0 asli."""
    global _CLI_EXACT_TEMPLATES
    if _CLI_EXACT_TEMPLATES is not None:
        return _CLI_EXACT_TEMPLATES
    path = HERE / "re" / "captures_cli" / "cli_chat_request_2.144.0.json"
    try:
        with open(path, encoding="utf-8") as f:
            cap = json.load(f)
        body = cap["body"]
        user_blocks = body["messages"][1]["content"]
        _CLI_EXACT_TEMPLATES = {
            "system_prompt": body["messages"][0]["content"],
            "tools": body["tools"],
            "memory_block": user_blocks[0]["text"],
            "context_block": user_blocks[1]["text"],
            "body_fields": {
                "model": body["model"],
                "temperature": body["temperature"],
                "max_tokens": body["max_tokens"],
                "stream_options": body.get("stream_options"),
                "reasoning_effort": body.get("reasoning_effort"),
            },
        }
        log(f"[cli_exact] templates loaded: system={len(_CLI_EXACT_TEMPLATES['system_prompt'])} chars, tools={len(_CLI_EXACT_TEMPLATES['tools'])}")
    except Exception as e:
        log(f"[cli_exact] template load gagal ({e}) — fallback ke body minimal", "ERR")
        _CLI_EXACT_TEMPLATES = {"system_prompt": None, "tools": None, "memory_block": None, "context_block": None, "body_fields": {}}
    return _CLI_EXACT_TEMPLATES


def run_one(idx, refresh_token, proxy=None, do_meter=False, prompt="hi", identity="cli"):
    idn = IDENTITIES.get(identity, IDENTITIES["cli"])
    base, domain = _base_for_refresh(refresh_token)
    op = _opener(proxy)
    tag = f"[{idx}]"

    # 1. refresh
    st, body = _post(op, base, "/v2/plugin/auth/token/refresh", {}, {
        "Content-Type": "application/json",
        "X-Domain": domain,
        "X-Refresh-Token": refresh_token,
        "X-Auth-Refresh-Source": "plugin",
        "User-Agent": idn["ua"],
    })
    if st != 200:
        return {"idx": idx, "ok": False, "stage": "refresh", "status": st, "err": body[:160]}
    try:
        access = json.loads(body)["data"]["accessToken"]
    except Exception:
        return {"idx": idx, "ok": False, "stage": "refresh", "status": st, "err": "no accessToken"}
    uid = _decode_uid(access)

    H = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": "Bearer " + access,
        "X-User-Id": uid,
        "X-Domain": domain,
        "X-Product": "SaaS",
        "X-IDE-Name": idn["ide_name"],
        "X-IDE-Type": idn["ide_type"],
        "X-IDE-Version": idn["ide_version"],
        "X-Agent-Intent": "craft",
        "X-Agent-Purpose": "conversation",
        "X-Agent-Type": "main",
        "X-Conversation-ID": str(uuid.uuid4()),
        "X-Conversation-Message-ID": uuid.uuid4().hex,
        "X-Conversation-Request-ID": uuid.uuid4().hex,
        "X-Request-ID": uuid.uuid4().hex,
        "User-Agent": idn["ua"],
        "x-requested-with": "XMLHttpRequest",
    }
    # identity ide_full/ide_exact: headers tambahan hasil capture IDE asli
    if idn.get("x_product_version"):
        H["X-Product-Version"] = idn["x_product_version"]
        H["X-Env-ID"] = idn["x_env_id"]
        H["X-Private-Data"] = idn["x_private_data"]
        H["X-Request-Trace-Id"] = str(uuid.uuid4())
        H["X-Trace-ID"] = uuid.uuid4().hex
        # chat pakai Accept SSE (sesuai capture IDE)
        H["Accept"] = "text/event-stream"
    # ide_exact: ID format hex32 + X-Model-ID (verified Frida TLSWrap capture)
    if idn.get("hex32_ids"):
        H["X-Conversation-ID"] = uuid.uuid4().hex
        H["X-Conversation-Message-ID"] = uuid.uuid4().hex
        H["X-Conversation-Request-ID"] = uuid.uuid4().hex
        H["X-Request-ID"] = H["X-Conversation-Request-ID"]  # selalu sama (verified)
    if idn.get("x_model_id"):
        H["X-Model-ID"] = "default-model"
    # cli_exact: headers khas CLI 2.144.0 (verified wire capture mitm)
    if idn.get("x_stainless"):
        H["x-stainless-arch"] = "arm64"
        H["x-stainless-lang"] = "js"
        H["x-stainless-os"] = "MacOS"
        H["x-stainless-package-version"] = "6.25.0"
        H["x-stainless-retry-count"] = "0"
        H["x-stainless-runtime"] = "node"
        H["x-stainless-runtime-version"] = "v24.15.0"
        H["x-codebuddy-request"] = "1"
        H["x-stainless-helper-method"] = "stream"
    if idn.get("root_request_id"):
        # X-Root-Request-ID + traceparent + b3 (verified capture CLI)
        if "X-Conversation-Request-ID" not in H:
            H["X-Conversation-Request-ID"] = uuid.uuid4().hex
        root = H["X-Conversation-Request-ID"]
        H["X-Root-Request-ID"] = root
        span = uuid.uuid4().hex[:16]
        parent = uuid.uuid4().hex[:16]
        H["traceparent"] = f"00-{root}-{span}-01"
        H["b3"] = f"{root}-{span}-1-{parent}"
        H["X-B3-TraceId"] = root
        H["X-B3-ParentSpanId"] = parent
        H["X-B3-SpanId"] = span
        H["X-B3-Sampled"] = "1"
        H["X-Trace-ID"] = root
        H["X-Request-ID"] = H.get("X-Conversation-Message-ID") or uuid.uuid4().hex

    meter_before = None
    if do_meter:
        st, body = _post(op, base, "/v2/billing/meter/get-user-resource", {
            "PageNumber": 1, "PageSize": 100, "ProductCode": "p_tcaca",
            "Status": [0, 3], "OnlyValidPeriod": True,
        }, H)
        try:
            meter_before = json.loads(body)["data"]["Response"]["Data"].get("TotalDosage")
        except Exception:
            meter_before = None

    # 2. chat — body construction
    # exact_body_used=True hanya kalau template exact berhasil dipakai.
    # Kalau template gagal load → fallback body minimal → usage ~0.00 →
    # reward TIDAK dibayar (verified 2026-09-10) — caller harus diwarn.
    exact_body_used = False
    if idn.get("exact_body") == "cli":
        # REPLIKASI EXACT body CLI 2.144.0 (capture mitm 2026-09-05)
        tpl = _load_cli_exact_templates()
        if tpl.get("system_prompt"):
            exact_body_used = True
        user_blocks = [
            {"type": "text", "text": tpl["memory_block"]},
            {"type": "text", "text": tpl["context_block"]},
            {"type": "text", "text": f"<user_query>{prompt}</user_query>"},
        ]
        chat = {
            "model": tpl["body_fields"].get("model", "default-model"),
            "messages": [
                {"role": "system", "content": tpl["system_prompt"]},
                {"role": "user", "content": user_blocks},
            ],
            "tools": tpl["tools"],
            "temperature": tpl["body_fields"].get("temperature", 1),
            "max_tokens": tpl["body_fields"].get("max_tokens", 24000),
            "stream": True,
            "stream_options": tpl["body_fields"].get("stream_options", {"include_usage": True}),
            "reasoning_effort": tpl["body_fields"].get("reasoning_effort", "high"),
        }
    elif idn.get("exact_body"):
        # REPLIKASI EXACT body IDE asli (capture JSON.stringify 2026-09-04)
        tpl = _load_ide_exact_templates()
        if tpl.get("system_prompt"):
            exact_body_used = True
        now = time.strftime("%A, %B %d, %Y")
        user_content = (
            "<user_info>\n"
            "OS Version: darwin\n"
            "Shell: Zsh\n"
            "Workspace Folder: /Users/rivanalbaniray/CodeBuddy/" + time.strftime("%Y%m%d%H%M%S") + "\n"
            "Note: Prefer using absolute paths over relative paths as tool call args when possible.\n"
            "</user_info>\n\n"
            "<artifact_directory_path>\n"
            "Artifact Directory Path: /Users/rivanalbaniray/Library/Application Support/CodeBuddy/User/globalStorage/tencent-cloud.coding-copilot/brain/" + uuid.uuid4().hex + "\n"
            "</artifact_directory_path>\n\n"
            "<project_context>\n\n"
            "<project_layout>\n"
            "Below is a snapshot of the current workspace's file structure at the start of the conversation. This snapshot will NOT update during the conversation.\n"
            "/Users/rivanalbaniray/CodeBuddy/" + time.strftime("%Y%m%d%H%M%S") + "/\n\n"
            "Note: File extension counts do not include files ignored by .gitignore.\n"
            "</project_layout>\n"
            "</project_context>\n\n"
            "<additional_data>\n"
            "Below are some potentially helpful/relevant pieces of information for figuring out how to respond:\n\n"
            "current_time: " + now + "\n"
            "</additional_data>\n\n"
            "<user_query>\n" + prompt + "\n</user_query>"
        )
        chat = {
            "model": "default-model",
            "max_tokens": 24000,
            "temperature": 1,
            "messages": [
                {"role": "system", "content": tpl["system_prompt"]},
                {"role": "user", "content": user_content},
            ],
            "tools": tpl["tools"],
            "tool_choice": "auto",
            "stream": True,
        }
    else:
        # Body minimal (resep CLI klasik — verified 2026-09-04)
        chat = {
            "model": "default-model",
            "messages": [
                {"role": "system", "content": "You are CodeBuddy, a coding assistant."},
                {"role": "user", "content": prompt},
            ],
            "stream": True,
            "max_tokens": 32,
        }
    st, body = _post(op, base, "/v2/chat/completions", chat, H)
    chat_ok = st == 200 and ("chat.completion.chunk" in body or "text/event-stream" in body or "data:" in body)
    if not chat_ok:
        return {"idx": idx, "ok": False, "stage": "chat", "status": st, "uid": uid, "err": body[:200]}
    # 3. report
    try:
        uname = json.loads(
            base64.urlsafe_b64decode(access.split(".")[1] + "==").ljust(300, "=")
        ).get("preferred_username", "") or ""
    except Exception:
        uname = ""
    if idn.get("exact_body") == "cli":
        # Report CLI 2.144.0 style: chat_request_send + chat_message_send (verified capture)
        ts = int(time.time() * 1000)
        conv_id = H["X-Conversation-ID"]
        req_id = H.get("X-Conversation-Request-ID", uuid.uuid4().hex)
        msg_id = H.get("X-Conversation-Message-ID", uuid.uuid4().hex)
        common = dict(idn.get("report_extra", {}))
        common.update({
            "userId": uid, "username": uname, "userNickname": uname,
            "product": "SaaS", "sessionId": str(uuid.uuid4()),
            "ideName": idn["ide_name"], "ideType": idn["ide_type"],
            "ideVersion": idn["ide_version"],
        })
        report = [
            {
                "eventCode": "chat_request_send", "timestamp": ts, "reportDelay": 2000,
                "mode": "unknown", "conversationId": conv_id, "requestId": req_id,
                "inputLength": len(prompt), "requestModelId": "default-model",
                "requestModelName": "Auto", "isPlan": False,
                "isAutoExecuteTerminal": False, "isAutoModify": False,
                "codebaseEnable": False, "maxToken": 0, "maxSteps": 500,
                "temperature": 0, "maxRetries": 0, "mentionContexts": [],
                "knowledgeId": [], "knowledgeName": [], "codebaseId": "",
                "mentionContextCount": 0, "command": "", "recommendId": "",
                "skillId": "", "skillCount": 0, "totalCount": 0,
                "presentAt": ts, "traceId": req_id, "rootRequestId": req_id,
                "parentConversationId": conv_id, "agentName": "cli", "agentType": "main",
                "vcsType": "unknown", "vcsRepo": "", "vcsBranchName": "", "vcsRevId": "",
                "codebuddy.session_id": conv_id,
                "codebuddy.conversation_request_id": req_id,
                **common,
            },
            {
                "eventCode": "chat_message_send", "timestamp": ts + 30, "reportDelay": 2001,
                "conversationId": conv_id, "requestId": req_id, "messageId": msg_id,
                "requestModelId": "default-model", "requestModelName": "Auto",
                "historyCount": 1, "isContextTruncated": False, "currentStepCount": 1,
                "presentAt": ts, "traceId": req_id, "rootRequestId": req_id,
                "parentConversationId": conv_id, "agentName": "cli", "agentType": "main",
                "vcsType": "unknown", "vcsRepo": "", "vcsBranchName": "", "vcsRevId": "",
                "codebuddy.session_id": conv_id,
                "codebuddy.conversation_request_id": req_id,
                **common,
            },
        ]
    else:
        report = [{
            "eventCode": "agent_task_created",
            "timestamp": int(time.time() * 1000),
            "conversationId": H["X-Conversation-ID"],
            "requestModelName": "default-model",
            "ideName": idn["ide_name"],
            "ideType": idn["ide_type"],
            "ideVersion": idn["ide_version"],
            "userId": uid,
            "product": "SaaS",
            "os": "darwin",
        }]
        # identity ide_full: body report versi IDE lengkap (capture 2026-09-04)
        if idn.get("report_extra"):
            extra = dict(idn["report_extra"])
            extra["username"] = uname
            extra["userNickname"] = uname
            extra["sessionId"] = str(uuid.uuid4())
            extra["reportDelay"] = 2000
            extra["requestModelId"] = "default-model"
            extra["action"] = ""
            report[0].update(extra)
    st_r, body_r = _post(op, base, "/v2/report", report, H)
    report_ok = st_r == 200

    res = {
        "idx": idx, "ok": True, "uid": uid, "realm": domain,
        "chat_status": st, "report_status": st_r, "report_ok": report_ok,
        "exact_body_used": exact_body_used,
    }
    if do_meter:
        res["meter_before"] = meter_before
    return res


# ── Retry & rate-limit handling (opsi 1: auto-retry + backoff) ──────────────
# 429 "too many requests" (code 14003) = rate limit PER-IP, bukan per-akun.
# Kalau 1 worker kena, kemungkinan besar worker lain juga kena → semua worker
# pause bersama lewat cooldown global, lalu backoff naik eksponensial
# (5s → 10s → 20s → 40s, cap 60s) sampai lolos lagi.
_rate_state = {"cooldown_until": 0.0, "backoff": 5.0}
_rate_lock = threading.Lock()


def _enter_rate_cooldown():
    """Set global cooldown & naikkan backoff. Return epoch sampai cooldown."""
    with _rate_lock:
        _rate_state["cooldown_until"] = time.time() + _rate_state["backoff"]
        _rate_state["backoff"] = min(_rate_state["backoff"] * 2, 60.0)
        return _rate_state["cooldown_until"]


def _reset_rate_backoff():
    with _rate_lock:
        _rate_state["backoff"] = 5.0


def _wait_rate_cooldown():
    """Block sampai cooldown global lewat (worker lain kena 429 → semua nunggu)."""
    while True:
        with _rate_lock:
            until = _rate_state["cooldown_until"]
        remain = until - time.time()
        if remain <= 0:
            return
        time.sleep(min(remain, 30))


def _is_rate_limited(rec):
    """429 / code 14003 'too many requests'."""
    err = str((rec or {}).get("err", "")).lower()
    return (rec or {}).get("status") == 429 or "too many requests" in err


def _is_retryable(rec):
    """Kegagalan yang layak retry: 429, 5xx, network error, exception."""
    if not rec or rec.get("ok") or rec.get("refresh_ok"):
        return False
    if _is_rate_limited(rec):
        return True
    st = rec.get("status")
    if isinstance(st, int) and st >= 500:
        return True
    if st == -1 or str(rec.get("err", "")).startswith("NETERR"):
        return True
    if rec.get("stage") == "exception":
        return True
    return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", default="9router_refresh.txt")
    ap.add_argument("--workers", type=int, default=5)
    ap.add_argument("--limit", type=int, default=0, help="proses hanya N token pertama")
    ap.add_argument("--offset", type=int, default=0, help="mulai dari token ke-N (0-based)")
    ap.add_argument("--proxy", default=None, help="mis. http://127.0.0.1:8081")
    ap.add_argument("--prompt", default="hi")
    ap.add_argument("--identity", choices=["cli", "ide", "ide_full", "ide_exact", "cli_exact"], default="cli_exact", help="spoof client identity. DEFAULT cli_exact = resep verified daily reward (usage ~1.2 → +30cr; cli minimal 0.00 → TIDAK dibayar, verified 2026-09-10)")
    ap.add_argument("--meter", action="store_true", help="cek TotalDosage sebelum chat")
    ap.add_argument("--dry-run", action="store_true", help="jangan kirim chat, cuma refresh")
    ap.add_argument("--out", default=None, help="file hasil jsonl (default: TIDAK menulis file apa pun)")
    ap.add_argument("--retry", type=int, default=3, help="retry otomatis untuk gagal yang retryable (429 rate limit / 5xx / NETERR / exception). Default 3. 0 = matikan retry")
    ap.add_argument("--pace", type=float, default=0.5, help="jeda minimum detik antar-request per worker (jitter 0-50%%). Default 0.5 — bantu menghindari burst 429")
    args = ap.parse_args()

    path = HERE / args.file
    tokens = [l.strip() for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]
    total = len(tokens)
    tokens = tokens[args.offset:(args.offset + args.limit) if args.limit else None]
    log(f"Loaded {total} token dari {args.file}; proses {len(tokens)} (offset {args.offset})")

    out_path = args.out  # tanpa --out: tidak ada file jsonl yang ditulis
    out_lock = threading.Lock()

    def write_out(rec):
        if not out_path:
            return
        with out_lock:
            with open(out_path, "a", encoding="utf-8") as f:
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")

    results = {"ok": 0, "fail": 0}
    t0 = time.time()

    def work(pair):
        i, tok = pair
        try:
            if args.dry_run:
                base, domain = _base_for_refresh(tok)
                op = _opener(args.proxy)
                st, body = _post(op, base, "/v2/plugin/auth/token/refresh", {}, {
                    "Content-Type": "application/json", "X-Domain": domain,
                    "X-Refresh-Token": tok, "X-Auth-Refresh-Source": "plugin",
                })
                ok = st == 200 and "accessToken" in body
                rec = {"idx": i, "dry": True, "refresh_ok": ok, "status": st}
            else:
                rec = run_one(i, tok, proxy=args.proxy, do_meter=args.meter, prompt=args.prompt, identity=args.identity)
        except Exception as e:
            rec = {"idx": i, "ok": False, "stage": "exception", "err": str(e)[:200]}

        # ── Auto-retry (opsi 1): 429/5xx/NETERR/exception → retry + backoff ──
        attempt = 0
        while args.retry > 0 and _is_retryable(rec) and attempt < args.retry:
            attempt += 1
            if _is_rate_limited(rec):
                until = _enter_rate_cooldown()
                log(f"[{i}] ⏳ 429 rate-limit → cooldown global sampai " + time.strftime("%H:%M:%S", time.localtime(until)) + f" (retry {attempt}/{args.retry})")
                _wait_rate_cooldown()
            else:
                delay = min(2.0 * (2 ** (attempt - 1)), 30.0)
                log(f"[{i}] ⏳ {rec.get('stage')} gagal (retryable) → tunggu {delay:.0f}s (retry {attempt}/{args.retry})")
                time.sleep(delay)
            try:
                if args.dry_run:
                    base, domain = _base_for_refresh(tok)
                    op = _opener(args.proxy)
                    st, body = _post(op, base, "/v2/plugin/auth/token/refresh", {}, {
                        "Content-Type": "application/json", "X-Domain": domain,
                        "X-Refresh-Token": tok, "X-Auth-Refresh-Source": "plugin",
                    })
                    rec = {"idx": i, "dry": True, "refresh_ok": st == 200 and "accessToken" in body, "status": st}
                else:
                    rec = run_one(i, tok, proxy=args.proxy, do_meter=args.meter, prompt=args.prompt, identity=args.identity)
            except Exception as e:
                rec = {"idx": i, "ok": False, "stage": "exception", "err": str(e)[:200]}

        # Sukses pertama yang lolos → reset backoff global
        if rec.get("ok") or rec.get("refresh_ok"):
            _reset_rate_backoff()

        # Pacing: jeda kecil + jitter antar-request per worker
        time.sleep(args.pace * (1.0 + random.uniform(0, 0.5)))

        write_out(rec)
        okk = rec.get("ok") or rec.get("refresh_ok")
        results["ok" if okk else "fail"] += 1
        flag = "OK " if okk else "FAIL"
        extra = ""
        if not okk:
            extra = f" stage={rec.get('stage')} st={rec.get('status')} err={rec.get('err','')[:80]}"
        elif not args.dry_run:
            extra = f" uid={rec.get('uid','')[:8]} chat={rec.get('chat_status')} report={rec.get('report_status')}"
        log(f"{flag} [{i}]{extra}")
        return rec

    pairs = list(enumerate(tokens, start=args.offset))
    with cf.ThreadPoolExecutor(max_workers=args.workers) as ex:
        list(ex.map(work, pairs))

    dt = time.time() - t0
    _out_note = f" -> {out_path}" if out_path else ""
    log(f"SELESAI: {results['ok']} OK, {results['fail']} FAIL dalam {dt:.1f}s{_out_note}")


if __name__ == "__main__":
    main()
