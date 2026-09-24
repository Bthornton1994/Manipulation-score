#!/usr/bin/env python3
# Local Trafilatura extraction for Media Lens preparation.
# Reads one JSON object from stdin. Writes one JSON object to stdout.
# Does not fetch URLs. Network refusal covers the Python socket methods
# listed in refuse_network() and the dependency wrappers installed after
# import. It is not a kernel network namespace. See DEPS.md.

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


def _mark_refusal(fn):
    fn._media_lens_refusal = "network"
    return fn


@_mark_refusal
def _refuse_network(*_args, **_kwargs):
    raise RuntimeError("network_refused")


@_mark_refusal
def _refuse_socket_method(_self, *_args, **_kwargs):
    raise RuntimeError("network_refused")


def refuse_network():
    """Block the connect paths this process and the pinned stack actually call.

    Enforced here, before those libraries are imported:
    - socket.socket.connect
    - socket.socket.connect_ex (also used by ssl.SSLSocket via super())
    - socket.create_connection (copied onto http.client connections at init)
    - socket.getaddrinfo (urllib3.util.connection.create_connection resolves first)

    Not enforced: the _socket C API, ctypes, a raw file descriptor, or
    optional modules that are not in the pin (pycurl, PySocks).
    """
    socket.socket.connect = _refuse_socket_method
    socket.socket.connect_ex = _refuse_socket_method
    socket.create_connection = _refuse_network
    socket.getaddrinfo = _refuse_network


def install_dependency_refusal():
    """Replace fetch wrappers the pinned packages expose or capture at import.

    urllib3.util.connection.create_connection calls socket.getaddrinfo and
    then socket.socket.connect. http.client.HTTPConnection copies
    socket.create_connection onto the instance in __init__. urllib.request.urlopen
    is the py3langid model-download path and is not used for article text.
    htmldate.utils.fetch_url and courlan.network.redirection_test use urllib3
    pools created at import, so they hit the same socket patches.
    """
    import http.client
    import urllib.request

    import urllib3.util.connection as urllib3_connection

    urllib3_connection.create_connection = _refuse_network
    urllib.request.urlopen = _refuse_network
    http.client.HTTPConnection.connect = _refuse_socket_method

    try:
        import htmldate.utils as htmldate_utils

        htmldate_utils.fetch_url = _refuse_network
    except Exception:
        pass

    try:
        import courlan.network as courlan_network

        courlan_network.redirection_test = _refuse_network
    except Exception:
        pass


def _refusal_marker(fn):
    func = getattr(fn, "__func__", fn)
    return getattr(func, "_media_lens_refusal", None)


def _invoke_refused(name, marker_fn, call):
    if _refusal_marker(marker_fn) != "network":
        return {"path": name, "result": "unpatched"}
    try:
        call()
    except RuntimeError as exc:
        return {"path": name, "result": str(exc)}
    except Exception as exc:
        return {"path": name, "result": type(exc).__name__}
    return {"path": name, "result": "allowed"}


def network_block_probe():
    """Exercise patched connect paths. Missing patches are not called.

    Addresses are the TEST-NET documentation range. A path is invoked only
    when its marker is this module's refusal, or, for ssl.SSLSocket, when
    socket.socket.connect / connect_ex is already that refusal. SSLSocket
    delegates to those methods through super() before any handshake.
    """
    refuse_network()
    import http.client
    import ssl
    import urllib.request

    import urllib3.util.connection as urllib3_connection
    from trafilatura import downloads

    import trafilatura

    install_fetch_refusal(trafilatura, downloads)
    install_dependency_refusal()

    address = ("192.0.2.1", 9)
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    context = ssl.create_default_context()

    def make_ssl_socket():
        return context.wrap_socket(socket.socket(socket.AF_INET, socket.SOCK_STREAM), server_hostname="192.0.2.1")

    ssl_connect_sock = make_ssl_socket()
    ssl_connect_ex_sock = make_ssl_socket()
    http_conn = http.client.HTTPConnection("192.0.2.1", 9, timeout=0.01)
    checks = [
        _invoke_refused("socket.socket.connect", sock.connect, lambda: sock.connect(address)),
        _invoke_refused("socket.socket.connect_ex", sock.connect_ex, lambda: sock.connect_ex(address)),
        _invoke_refused("socket.create_connection", socket.create_connection, lambda: socket.create_connection(address, 0.01)),
        _invoke_refused("socket.getaddrinfo", socket.getaddrinfo, lambda: socket.getaddrinfo("192.0.2.1", 9)),
        _invoke_refused("http.client.HTTPConnection.connect", http_conn.connect, http_conn.connect),
        _invoke_refused(
            "http.client.HTTPConnection._create_connection",
            http_conn._create_connection,
            lambda: http_conn._create_connection(address, 0.01),
        ),
        _invoke_refused(
            "urllib3.util.connection.create_connection",
            urllib3_connection.create_connection,
            lambda: urllib3_connection.create_connection(address, 0.01),
        ),
        _invoke_refused("urllib.request.urlopen", urllib.request.urlopen, lambda: urllib.request.urlopen("http://192.0.2.1/")),
        _invoke_refused("trafilatura.fetch_url", trafilatura.fetch_url, lambda: trafilatura.fetch_url("http://192.0.2.1/")),
        _invoke_refused("trafilatura.downloads.fetch_url", downloads.fetch_url, lambda: downloads.fetch_url("http://192.0.2.1/")),
    ]
    if _refusal_marker(socket.socket.connect) == "network":
        checks.append(_invoke_refused("ssl.SSLSocket.connect", socket.socket.connect, lambda: ssl_connect_sock.connect(address)))
    else:
        checks.append({"path": "ssl.SSLSocket.connect", "result": "unpatched"})
    if _refusal_marker(socket.socket.connect_ex) == "network":
        checks.append(_invoke_refused("ssl.SSLSocket.connect_ex", socket.socket.connect_ex, lambda: ssl_connect_ex_sock.connect_ex(address)))
    else:
        checks.append({"path": "ssl.SSLSocket.connect_ex", "result": "unpatched"})
    try:
        import htmldate.utils as htmldate_utils

        checks.append(_invoke_refused("htmldate.utils.fetch_url", htmldate_utils.fetch_url, lambda: htmldate_utils.fetch_url("http://192.0.2.1/")))
    except Exception:
        checks.append({"path": "htmldate.utils.fetch_url", "result": "import_failed"})
    try:
        import courlan.network as courlan_network

        checks.append(
            _invoke_refused(
                "courlan.network.redirection_test",
                courlan_network.redirection_test,
                lambda: courlan_network.redirection_test("http://192.0.2.1/"),
            )
        )
    except Exception:
        checks.append({"path": "courlan.network.redirection_test", "result": "import_failed"})
    sock.close()
    ssl_connect_sock.close()
    ssl_connect_ex_sock.close()
    return checks


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

    _refuse_fetch._media_lens_refusal = "network"
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
    install_dependency_refusal()
    if request.get("probe_network") is True:
        emit({"status": "ok", "error_code": None, "network_probe": network_block_probe()})
        return 0
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
