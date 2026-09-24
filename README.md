# PDF Tool

Công cụ chạy ngay trên máy Mac để **phân tích, chỉnh sửa, nén và tách** các file PDF nặng (hàng trăm MB), giúp gửi file qua Zalo, email và các ứng dụng khác dễ hơn. Giao diện mở trong trình duyệt. Mọi xử lý đều diễn ra trên máy, không file nào được gửi ra ngoài.

## Tính năng

- **Phân tích dung lượng:** cho biết trang nào nặng, ảnh bao nhiêu DPI, và dung lượng nằm ở ảnh hay font. Rê chuột lên trang để thấy từng ảnh nặng.
- **Xem cả file như Acrobat:** cột giữa cuộn liên tục qua mọi trang, có zoom và nhảy tới số trang. Mở được cả file hàng nghìn trang mà vẫn mượt.
- **Chỉnh sửa trang:**
  - xóa, xoay, kéo thả để sắp xếp lại;
  - chèn trang trắng, ảnh hoặc các trang lấy từ một PDF khác;
  - hoàn tác và làm lại.
- **Nén toàn file** theo mục đích:
  - **Email ≤ 20 MB**
  - **Zalo / Mobile**
  - **Cân bằng**
  - **Chất lượng cao**
  - hoặc **"nén về dưới X MB"**: công cụ tự chọn mức nén phù hợp.

  Ngoài ra có tùy chỉnh nâng cao: DPI, chất lượng JPEG, chuyển ảnh xám cho trang scan, bỏ metadata, và Ghostscript.
- **Nén từng trang** với 3 mức Nhẹ / Vừa / Mạnh, dùng cho những trang cần nét hơn hoặc nhẹ hơn phần còn lại. Mức riêng của trang được ưu tiên hơn mức nén toàn file.
- **Ước tính tức thì:** ngay sau khi mở file, công cụ tính sẵn một "hồ sơ nén" ở chế độ nền. Nhờ đó, khi mở hộp thoại nén, bạn thấy ngay dung lượng dự kiến của từng lựa chọn mà không phải chờ.
- **Trích và tách file** theo khoảng trang (ví dụ `1-10, 11-20`) hoặc theo dung lượng tối đa mỗi phần.
- **So sánh trước/sau** khi xuất xong, và mở vị trí file vừa xuất bằng nút "Hiện trong Finder".

File gốc không bao giờ bị ghi đè. File kết quả được lưu cạnh file gốc với tên mới.

## Yêu cầu hệ thống

| Thành phần | Ghi chú |
|---|---|
| macOS (Apple Silicon hoặc Intel) | Chọn file và "Hiện trong Finder" dùng hộp thoại của macOS. |
| [Homebrew](https://brew.sh) | Dùng để cài các công cụ bên dưới. |
| [uv](https://docs.astral.sh/uv/) | Tự cài Python ≥ 3.12 và các thư viện. |
| Node.js ≥ 20 | Chỉ cần lúc build giao diện. |
| Ghostscript *(không bắt buộc)* | Thiếu nó thì tùy chọn "Dùng Ghostscript" bị tắt; mọi tính năng khác vẫn chạy. |

```bash
brew install uv node ghostscript
```

## Cài đặt

**1. Lấy mã nguồn**

```bash
git clone <địa-chỉ-repo> pdftool
cd pdftool
```

**2. Build giao diện web.** Bắt buộc làm trước khi chạy hoặc cài đặt, vì giao diện đã build được đóng gói kèm công cụ:

```bash
cd web && npm install && npm run build && cd ..
```

**3. Cài `pdftool` thành lệnh dùng được ở mọi thư mục:**

```bash
uv tool install .
```

Nếu terminal báo không tìm thấy lệnh `pdftool`, chạy `uv tool update-shell` rồi mở lại terminal.

> Muốn dùng thử mà không cài: sau bước 2, chạy `uv run pdftool` ngay trong thư mục mã nguồn.

## Sử dụng

```bash
pdftool                    # mở trình duyệt với màn hình trống
pdftool ~/Downloads/a.pdf  # mở ngay một file
```

- Công cụ tự chọn một cổng trống trên `127.0.0.1` và tự mở trình duyệt. Terminal in ra địa chỉ, ví dụ `pdftool đang chạy tại http://127.0.0.1:53124`. Nhấn **Ctrl+C** để dừng.
- Mỗi lúc chỉ có **một phiên** chạy. Gọi `pdftool file.pdf` lần nữa sẽ mở file trong phiên đang chạy, không khởi động phiên thứ hai.
- Mở file bằng nút **"Mở file…"** thì công cụ đọc file tại chỗ, không sao chép. Kéo thả file vào cửa sổ thì file được sao chép vào thư mục dữ liệu của công cụ.

**Tùy chọn dòng lệnh**

| Tùy chọn | Tác dụng |
|---|---|
| `--port N` | Chạy ở cổng cố định thay vì cổng ngẫu nhiên. |
| `--no-browser` | Không tự mở trình duyệt, ví dụ khi muốn tự mở địa chỉ đã in ra. |

**Quy trình gợi ý để nén một file nặng**

1. Mở file và xem tab **Tổng quan** ở cột phải: dung lượng nằm ở đâu, những trang nào nặng.
2. Bấm **Nén toàn file** và chọn mục đích (Email, Zalo, …), hoặc nhập "dưới X MB". Dung lượng dự kiến hiện ngay trên từng lựa chọn.
3. Nếu cần, chọn vài trang và đặt mức riêng (Nhẹ / Vừa / Mạnh) ở tab **Trang**.
4. Bấm **Nén và xuất…**. Khi xuất xong, xem so sánh trước/sau và bấm **Hiện trong Finder**.

**Phím tắt**

| Phím | Tác dụng |
|---|---|
| ← / → (↑ / ↓) | Trang trước / trang sau |
| Delete | Xóa các trang đang chọn |
| ⌘Z / ⇧⌘Z | Hoàn tác / làm lại |
| Esc | Bỏ chọn, hoặc đóng hộp thoại |

## Cập nhật lên phiên bản mới

```bash
cd pdftool
git pull
cd web && npm install && npm run build && cd ..
uv tool install --reinstall .
```

## Gỡ cài đặt

```bash
uv tool uninstall pdftool
rm -rf ~/.pdftool          # xóa dữ liệu tạm và cache (không bắt buộc)
```

## Dữ liệu và quyền riêng tư

- Server chỉ lắng nghe ở `127.0.0.1` và từ chối các yêu cầu đến từ trang web khác, nên máy khác trong mạng không truy cập được.
- Dữ liệu tạm, file kéo thả và cache (ảnh trang đã vẽ, kết quả phân tích, hồ sơ nén) nằm ở `~/.pdftool`. Có thể đổi thư mục này bằng biến môi trường `PDFTOOL_HOME`.
- Cache giữ cả ảnh trang của **các file có mật khẩu**, nhưng mật khẩu thì không bao giờ được ghi xuống đĩa hay vào log.
- Có thể xóa `~/.pdftool` bất cứ lúc nào khi công cụ không chạy. Dữ liệu tạm cũ cũng được tự dọn mỗi lần khởi động.

## Xử lý sự cố

| Hiện tượng | Cách xử lý |
|---|---|
| `Chưa build giao diện web…` | Chạy `cd web && npm install && npm run build`. Nếu đã cài bằng `uv tool install`, cài lại bằng `uv tool install --reinstall .`. |
| `⚠️ Chưa có Ghostscript…` | `brew install ghostscript` (không bắt buộc). |
| `Không thể khởi động máy chủ trên cổng N` | Cổng đang bị dùng: bỏ `--port`, hoặc chọn cổng khác. |
| `pdftool đang khởi động, thử lại sau giây lát.` | Một phiên khác đang khởi động; chờ vài giây rồi chạy lại. |
| Trình duyệt không tự mở | Mở địa chỉ `http://127.0.0.1:…` mà terminal đã in ra. |
| Ước tính hiện "Đang chuẩn bị ước tính…" lâu | Hồ sơ nén đang được tính ở chế độ nền (file 500 MB mất khoảng 1 phút). Trong lúc chờ, công cụ vẫn ước tính qua máy chủ. |

## Giới hạn hiện tại

- Ảnh CMYK, ảnh dùng bảng màu (Indexed) và ảnh 1-bit được giữ nguyên khi nén thường; chỉ nén được khi bật Ghostscript.
- Ước tính tức thì có sai số mục tiêu khoảng ±35% so với file xuất thật. Các trang chèn từ ảnh, DPI/JPEG đặt tay hoặc khi bật Ghostscript thì dùng ước tính qua máy chủ (chậm hơn).
- Chưa có OCR, chú thích (annotate) hay ký số.

## Dành cho nhà phát triển

```bash
uv run pdftool --dev          # chỉ chạy backend, ở cổng 8765
cd web && npm run dev         # giao diện với hot reload: http://localhost:5173

uv run pytest                 # test backend
uv run pytest -m slow         # test hiệu năng (chậm)
cd web && npx vitest run      # unit test frontend
cd web && npm run e2e         # end-to-end, dùng Google Chrome đã cài trên máy
```

Công nghệ:
- Backend: Python, FastAPI, PyMuPDF, pikepdf.
- Giao diện: React, TypeScript, Tailwind CSS v4, shadcn/ui, lucide-react.

Các component shadcn nằm trong `web/src/components/ui/`. Thêm component mới bằng `npx shadcn@latest add <tên>`, không sửa tay các file này; theme nằm ở `web/src/index.css`.

## Giấy phép

Phát hành theo giấy phép [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0-or-later). Công cụ dùng [PyMuPDF](https://pymupdf.readthedocs.io), một thư viện theo AGPL-3.0, nên toàn bộ dự án cũng theo giấy phép này: bạn được tự do dùng, sửa và chia sẻ lại, với điều kiện bản chia sẻ lại (hoặc bản cung cấp cho người khác dùng qua mạng) phải công khai mã nguồn theo cùng giấy phép. Ghostscript (không bắt buộc) chỉ được gọi như một chương trình ngoài, không đóng gói kèm.
