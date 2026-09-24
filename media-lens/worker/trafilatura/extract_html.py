#!/usr/bin/env python3
# Local Trafilatura extraction for Media Lens preparation.
# Reads one JSON object from stdin. Writes one JSON object to stdout.
# Does not fetch URLs, follow links, or write the article to stderr.

import json
import logging
import re
import socket
import sys
import warnings

REQUIRED_TRAFILATURA = "2.2.0"
REQUIRED_PY3LANGID = "0.4.0"

TAG_RE = re.compile(r"<\s*/?\s*[a-zA-Z][^>]*>", re.S)
HTML_LANG_RE = re.compile(
    r"<html\b[^>]*\blang\s*=\s*[\"']([A-Za-z]{2,3}(?:-[A-Za-z0-9]+)*)",
    re.I,
)


def refuse_network():
    def _refuse(*_args, **_kwargs):
        raise RuntimeError("network_refused")

    socket.create_connection = _refuse
    socket.socket.connect = lambda self, *args, **kwargs: _refuse()


def emit(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    sys.stdout.write("\n")


def base_payload(status, error_code=None):
    return {
        "status": status,
        "error_code": error_code,
        "extractor": "trafilatura",
        "extractor_version": None,
        "language_detector": "py3langid",
        "language_detector_version": None,
        "detected_language": None,
        "html_lang": None,
        "title": None,
        "author": None,
        "date": None,
        "text": None,
    }


def load_libraries():
    import importlib.metadata as metadata

    import trafilatura
    from trafilatura import downloads
    from trafilatura.utils import language_classifier

    trafilatura_version = metadata.version("trafilatura")
    py3langid_version = metadata.version("py3langid")
    return trafilatura, downloads, language_classifier, trafilatura_version, py3langid_version


def install_fetch_refusal(trafilatura, downloads):
    def _refuse_fetch(*_args, **_kwargs):
        raise RuntimeError("fetch_refused")

    trafilatura.fetch_url = _refuse_fetch
    if hasattr(downloads, "fetch_url"):
        downloads.fetch_url = _refuse_fetch


def classify_html(html):
    if not isinstance(html, str):
        return "unsupported"
    if "\x00" in html:
        return "unsupported"
    stripped = html.strip()
    if stripped == "":
        return "empty"
    if stripped.startswith("%PDF"):
        return "unsupported"
    if stripped[0] in "{[" and "<" not in stripped:
        return "unsupported"
    if not TAG_RE.search(stripped):
        return "unsupported"
    return "html"


def html_language(html):
    if not isinstance(html, str):
        return None
    match = HTML_LANG_RE.search(html)
    return match.group(1) if match else None


def metadata_text(value):
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def extract_html(html, bare_extraction, language_classifier, versions):
    kind = classify_html(html)
    payload = base_payload(kind if kind != "html" else "ok")
    payload["extractor_version"] = versions[0]
    payload["language_detector_version"] = versions[1]
    payload["html_lang"] = html_language(html) if isinstance(html, str) else None
    if kind != "html":
        return payload

    try:
        document = bare_extraction(
            html,
            include_comments=False,
            favor_precision=True,
            with_metadata=True,
            include_formatting=False,
            include_links=False,
            include_images=False,
        )
    except Exception:
        payload["status"] = "parse_failed"
        payload["error_code"] = "extract_exception"
        return payload

    if document is None:
        payload["status"] = "empty"
        payload["error_code"] = "no_document"
        return payload

    data = document.as_dict() if hasattr(document, "as_dict") else document
    text = metadata_text(data.get("text") if isinstance(data, dict) else None)
    if not text or not re.search(r"\w{2,}", text):
        payload["status"] = "empty"
        payload["error_code"] = "no_text"
        return payload

    try:
        detected = language_classifier(text, "")
    except Exception:
        detected = None

    payload["status"] = "ok"
    payload["text"] = text
    payload["title"] = metadata_text(data.get("title") if isinstance(data, dict) else None)
    payload["author"] = metadata_text(data.get("author") if isinstance(data, dict) else None)
    payload["date"] = metadata_text(data.get("date") if isinstance(data, dict) else None)
    payload["detected_language"] = metadata_text(detected)
    return payload


def detect_text(text, language_classifier, versions):
    payload = base_payload("ok")
    payload["extractor_version"] = versions[0]
    payload["language_detector_version"] = versions[1]
    if not isinstance(text, str):
        payload["status"] = "unsupported"
        payload["error_code"] = "text_type"
        return payload
    stripped = text.strip()
    if stripped == "":
        payload["status"] = "empty"
        payload["error_code"] = "no_text"
        return payload
    try:
        detected = language_classifier(stripped, "")
    except Exception:
        detected = None
    payload["detected_language"] = metadata_text(detected)
    return payload


def main():
    warnings.filterwarnings("ignore")
    logging.disable(logging.CRITICAL)
    refuse_network()

    raw = sys.stdin.read()
    try:
        request = json.loads(raw) if raw.strip() else {}
    except Exception:
        emit(base_payload("parse_failed", "request_json"))
        return 0

    if not isinstance(request, dict):
        emit(base_payload("unsupported", "request_type"))
        return 0

    if any(key in request for key in ("fetch_url", "download", "crawl")):
        emit(base_payload("error", "fetch_refused"))
        return 0

    try:
        trafilatura, downloads, language_classifier, trafilatura_version, py3langid_version = load_libraries()
    except Exception:
        emit(base_payload("error", "extractor_unavailable"))
        return 0

    install_fetch_refusal(trafilatura, downloads)
    versions = (trafilatura_version, py3langid_version)
    if trafilatura_version != REQUIRED_TRAFILATURA or py3langid_version != REQUIRED_PY3LANGID:
        payload = base_payload("error", "version_mismatch")
        payload["extractor_version"] = trafilatura_version
        payload["language_detector_version"] = py3langid_version
        emit(payload)
        return 0

    # url is ignored on purpose: this process never retrieves a page.
    if "html" in request:
        emit(extract_html(request.get("html"), trafilatura.bare_extraction, language_classifier, versions))
        return 0
    if "text" in request:
        emit(detect_text(request.get("text"), language_classifier, versions))
        return 0

    emit(base_payload("unsupported", "missing_input"))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        emit(base_payload("error", "extractor_crash"))
        sys.exit(0)
