##Extract text and page information 
import pymupdf

def extract_pages(pdf_path):
    pages = []

    doc = pymupdf.open(pdf_path)

    try:
        for page_num in range(len(doc)):
            page = doc[page_num]
            text = page.get_text()

            page_data = {
                "page_number": page_num + 1,
                "text": text
            }

            pages.append(page_data)

    finally:
        doc.close()

    return pages

pdf=extract_pages("F:/paper pilot/project/test_papers/research.pdf")
count= len(pdf)
print(count)