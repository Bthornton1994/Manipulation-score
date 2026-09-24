# Trafilatura worker dependency

Article HTML preparation in `media-lens/worker/prepare.js` calls this local extractor. It is not part of the browser page, the PWA, or the GitHub Pages bundle.

| Package | Version | License | Role |
| --- | --- | --- | --- |
| [Trafilatura](https://github.com/adbar/trafilatura) | 2.2.0 | Apache-2.0 | Main-text and metadata extraction from HTML already on hand |
| [py3langid](https://github.com/adbar/py3langid) | 0.4.0 | BSD-3-Clause | Language identification for the extracted text |

Apache-2.0 terms: https://www.apache.org/licenses/LICENSE-2.0

The Node worker has no npm dependency on these packages. `requirements.txt` in this directory is the pin CI installs into a virtualenv and places on `PATH` as `python3`. `extract_html.py` refuses `fetch_url` and does not download the page it extracts. Live URL retrieval stays in `safe-fetch.js`.

Transitive packages in the pin (courlan, htmldate, justext, lxml, numpy, and the others listed in `requirements.txt`) are installation requirements of the two rows above. They are not called to fetch URLs.
