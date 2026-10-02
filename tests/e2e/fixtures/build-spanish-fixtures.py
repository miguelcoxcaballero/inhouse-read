#!/usr/bin/env python3
"""Regenerates lectura-es.epub and lectura-es.pdf (Spanish, short pages) used by neural-voice-reading.spec.mjs.
Short chapters/pages on purpose: a page ends after about twenty seconds of speech, so the e2e sees page turns quickly."""
import io, os, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
CHAPTERS = [
    ('La llegada', ['Después de un largo día, Ana volvió a casa y abrió el libro que su abuelo le había regalado.',
                    'La lluvia golpeaba suavemente los cristales de la vieja biblioteca.']),
    ('La pregunta', ['—¿Qué hora es? —preguntó él—. Ya es tarde, y el año que viene tendremos más tiempo.',
                     'Ella sonrió, cerró el libro y apagó la lámpara.']),
    ('El forastero', ['Nadie en el pueblo recordaba cuándo había llegado el forastero.',
                      'Todos coincidían en que traía consigo una maleta de cuero gastada.'])
]

def epub():
    xhtml = lambda title, paragraphs: ('<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xml:lang="es"><head><title>%s</title></head><body><h1>%s</h1>%s</body></html>'
        % (title, title, ''.join('<p>%s</p>' % p for p in paragraphs)))
    names = ['uno', 'dos', 'tres']
    opf = ('<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">lectura-es</dc:identifier><dc:title>La sala de lectura</dc:title><dc:language>es</dc:language><dc:creator>Inhouse</dc:creator><meta property="dcterms:modified">2026-10-01T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>%s</manifest><spine>%s</spine></package>'
        % (''.join('<item id="%s" href="%s.xhtml" media-type="application/xhtml+xml"/>' % (n, n) for n in names), ''.join('<itemref idref="%s"/>' % n for n in names)))
    nav = ('<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Índice</title></head><body><nav epub:type="toc"><ol>%s</ol></nav></body></html>'
        % ''.join('<li><a href="%s.xhtml">%s</a></li>' % (n, c[0]) for n, c in zip(names, CHAPTERS)))
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w') as z:
        z.writestr(zipfile.ZipInfo('mimetype'), 'application/epub+zip')
        z.writestr('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>', zipfile.ZIP_DEFLATED)
        z.writestr('book.opf', opf, zipfile.ZIP_DEFLATED); z.writestr('nav.xhtml', nav, zipfile.ZIP_DEFLATED)
        for n, (title, paragraphs) in zip(names, CHAPTERS): z.writestr(n + '.xhtml', xhtml(title, paragraphs), zipfile.ZIP_DEFLATED)
    open(os.path.join(HERE, 'lectura-es.epub'), 'wb').write(out.getvalue())

def wrap(text, width=50):
    lines, line = [], ''
    for word in text.split():
        if line and len(line) + 1 + len(word) > width: lines.append(line); line = word
        else: line = (line + ' ' + word).strip()
    return lines + [line]

def pdf():
    esc = lambda s: ''.join(c if c not in '()\\' and ord(c) < 128 else ('\\' + c if c in '()\\' else '\\%03o' % ord(c.encode('cp1252'))) for c in s)
    objs = ['<< /Type /Catalog /Pages 2 0 R >>', None, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>']
    kids = []
    for number, (title, paragraphs) in enumerate(CHAPTERS, 1):
        body = 'BT /F1 18 Tf 30 550 Td (%s) Tj /F1 12 Tf 0 -34 Td 18 TL ' % esc('%s. Página %d.' % (title, number))
        for line in [l for p in paragraphs for l in wrap(p)]: body += '(%s) \'\n' % esc(line)
        body += 'ET'
        page_id, content_id = 4 + 2 * (number - 1), 5 + 2 * (number - 1)
        kids.append('%d 0 R' % page_id)
        objs += ['<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 600] /Resources << /Font << /F1 3 0 R >> >> /Contents %d 0 R >>' % content_id,
                 '<< /Length %d >>\nstream\n%s\nendstream' % (len(body.encode('cp1252')), body)]
    objs[1] = '<< /Type /Pages /Kids [%s] /Count %d >>' % (' '.join(kids), len(kids))
    data = b'%PDF-1.4\n'
    offsets = []
    for i, o in enumerate(objs, 1):
        offsets.append(len(data)); data += ('%d 0 obj\n%s\nendobj\n' % (i, o)).encode('cp1252')
    xref = len(data)
    data += ('xref\n0 %d\n0000000000 65535 f \n' % (len(objs) + 1)).encode() + b''.join(b'%010d 00000 n \n' % o for o in offsets)
    data += ('trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n' % (len(objs) + 1, xref)).encode()
    open(os.path.join(HERE, 'lectura-es.pdf'), 'wb').write(data)

epub(); pdf()
