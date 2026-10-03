"""Deterministic, original multi-chapter EPUB for the signed APK media check."""
from zipfile import ZipFile, ZIP_DEFLATED

def write_audiobook(path):
    chapters = 24
    with ZipFile(path, "w") as book:
        book.writestr("mimetype", "application/epub+zip")
        book.writestr("META-INF/container.xml", '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>', compress_type=ZIP_DEFLATED)
        manifest = '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>'
        manifest += ''.join(f'<item id="c{i}" href="c{i}.xhtml" media-type="application/xhtml+xml"/>' for i in range(chapters))
        spine = ''.join(f'<itemref idref="c{i}"/>' for i in range(chapters))
        book.writestr("content.opf", f'<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">natural-background-24-chapters</dc:identifier><dc:title>Intent audiobook</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-10-03T00:00:00Z</meta></metadata><manifest>{manifest}</manifest><spine>{spine}</spine></package>', compress_type=ZIP_DEFLATED)
        links=''.join(f'<li><a href="c{i}.xhtml">Chapter {i+1}</a></li>' for i in range(chapters))
        book.writestr("nav.xhtml", f'<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol>{links}</ol></nav></body></html>', compress_type=ZIP_DEFLATED)
        for i in range(chapters):
            # ~20 seconds per section: enough to cross several real spine items
            # while locked, and enough total speech to remain active >6 minutes.
            text = (f'This is chapter {i+1}. The quiet reader listens to a natural voice. '
                    'Every sentence follows the words of the book in their original order. '
                    'The next chapter continues without touching the screen. '
                    'The sound keeps moving while the display is locked. '
                    'No sentence is replaced by a voice from the device.')
            book.writestr(f'c{i}.xhtml', f'<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter {i+1}</title></head><body><p>{text}</p></body></html>', compress_type=ZIP_DEFLATED)

def write_background_pdf(path):
    """Four real printed pages; enough first-page speech to lock before its end."""
    objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [4 0 R 6 0 R 8 0 R 10 0 R] /Count 4 >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
    for page in range(4):
        lines=[f'This is physical page {page+1} of the natural audiobook.']
        lines += [f'Line {i+1} follows the printed words in order while the display is locked.' for i in range(12)]
        content=''.join(f'BT /F1 12 Tf 1 0 0 1 40 {750-i*32} Tm ({line}) Tj ET\n' for i,line in enumerate(lines))
        n=len(objects)+1
        objects += [f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents {n+1} 0 R >>',f'<< /Length {len(content.encode())} >>\nstream\n{content}endstream']
    pdf='%PDF-1.4\n';offsets=[]
    for i,obj in enumerate(objects):
        offsets.append(len(pdf.encode()));pdf+=f'{i+1} 0 obj\n{obj}\nendobj\n'
    xref=len(pdf.encode());pdf+=f'xref\n0 {len(objects)+1}\n0000000000 65535 f \n'
    pdf+=''.join(f'{offset:010d} 00000 n \n' for offset in offsets)
    pdf+=f'trailer\n<< /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'
    path.write_bytes(pdf.encode())
