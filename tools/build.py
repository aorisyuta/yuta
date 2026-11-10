#!/usr/bin/env python3
"""分割したソース (index.html + css/ + js/) を 1 ファイルにまとめる。

    python3 tools/build.py            # dist/uniboard.html を作る

Android アプリ (WebView) や、オフラインで 1 ファイルだけ配りたいときに使う。
開発中は index.html をそのまま開けばよい (ビルド不要)。
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent


def inline(html: str) -> str:
    def css(m):
        return '<style>\n' + (ROOT / m.group(1)).read_text(encoding='utf-8') + '</style>'

    def js(m):
        body = (ROOT / m.group(1)).read_text(encoding='utf-8').replace('</script', '<\\/script')
        return '<script%s>\n%s</script>' % (m.group(2), body)

    html = re.sub(r'<link rel="stylesheet" href="((?:css)/[^"]+)">', css, html)
    html = re.sub(r'<script src="((?:js)/[^"]+)"([^>]*)></script>', js, html)
    return html


def main():
    out = ROOT / (sys.argv[1] if len(sys.argv) > 1 else 'dist/uniboard.html')
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(inline((ROOT / 'index.html').read_text(encoding='utf-8')), encoding='utf-8')
    print('wrote %s (%d KB)' % (out.relative_to(ROOT), out.stat().st_size // 1024))


if __name__ == '__main__':
    main()
