# Trafilatura worker dependency

Article HTML preparation in `media-lens/worker/prepare.js` calls this local extractor. It is not part of the browser page, the PWA, or the GitHub Pages bundle.

| Package | Version | License | Role |
| --- | --- | --- | --- |
| [Trafilatura](https://github.com/adbar/trafilatura) | 2.2.0 | Apache-2.0 | Main-text and metadata extraction from HTML already on hand |
| [py3langid](https://github.com/adbar/py3langid) | 0.4.0 | BSD-3-Clause | Language identification for the extracted text |

Apache-2.0 terms: https://www.apache.org/licenses/LICENSE-2.0

The Node worker has no npm dependency on these packages. Live URL retrieval stays in `safe-fetch.js`. The extractor is only given HTML or plain text the worker already holds.

## Runtime prerequisite

CI installs this pin into a virtualenv and puts that environment's `python3` on `PATH` before tests. Copying the repo to `ml-jev` does not. `docs/media-lens-frontend-deployment.md` copies the checkout and Caddy site files. It does not create this virtualenv, and nothing in the repo starts a host install.

On the worker host, before article preparation can succeed, install the pin and put its `bin` directory on the worker `PATH`:

```sh
media-lens/worker/trafilatura/install.sh /opt/media-lens/trafilatura-venv
```

The script runs `python3 -m venv` and `pip install -r media-lens/worker/trafilatura/requirements.txt`. It does not change live flags, contact Jev, or deploy by itself.

## Network refusal

`extract_html.py` is not a kernel network namespace. Before importing the pin, it replaces these Python methods so they raise `RuntimeError("network_refused")`:

- `socket.socket.connect`
- `socket.socket.connect_ex` (`ssl.SSLSocket` reaches this through `super()`)
- `socket.create_connection` (copied onto `http.client.HTTPConnection` at init)
- `socket.getaddrinfo` (called by `urllib3.util.connection.create_connection` before connect)

After import it also replaces `urllib3.util.connection.create_connection`, `http.client.HTTPConnection.connect`, `urllib.request.urlopen`, `trafilatura.fetch_url`, `trafilatura.downloads.fetch_url`, `htmldate.utils.fetch_url`, and `courlan.network.redirection_test`. Those are the connect and fetch paths used by the pinned packages. `htmldate` and `courlan` build urllib3 pools at import; those pools still call the patched socket methods.

This does not block the `_socket` C API, `ctypes`, an already-open file descriptor, or optional modules that are not in the pin (`pycurl`, PySocks). Transitive packages in `requirements.txt` are installation requirements. They are not given a URL by the worker.
