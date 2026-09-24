# pdftool

Công cụ PDF chạy trên máy (macOS), mở trong trình duyệt:

- **Phân tích** file: trang nào nặng, ảnh bao nhiêu DPI, cái gì chiếm dung lượng.
- **Chỉnh sửa trang**: xoay, xóa, sắp xếp lại, chèn trang trắng / ảnh / trang từ PDF khác, hoàn tác.
- **Nén** từng trang hoặc cả file (theo mức, theo preset, hoặc **"nén về dưới X MB"**), có ước tính dung lượng trước khi xuất.
- **Tách** file theo khoảng trang hoặc theo dung lượng tối đa mỗi phần.

Mọi xử lý đều diễn ra trên máy này — không gửi file đi đâu. Server chỉ nghe ở `127.0.0.1`.

## Yêu cầu

```sh
brew install uv ghostscript
```

và Node.js 20 trở lên (để build giao diện). Ghostscript không bắt buộc, nhưng thiếu nó thì tùy chọn nén mạnh nhất bị tắt.

## Cài đặt lần đầu

```sh
cd web && npm install && npm run build
```

## Chạy

```sh
uv run pdftool              # mở trình duyệt với màn hình trống
uv run pdftool file.pdf     # mở ngay file.pdf
```

Cài thành lệnh dùng ở mọi nơi (phải **build giao diện trước**, vì gói cài đặt đóng kèm `src/pdftool/static`):

```sh
cd web && npm install && npm run build && cd ..
uv tool install .
pdftool file.pdf
```

Chỉ chạy một phiên: gọi `pdftool` lần nữa sẽ mở tab mới vào phiên đang chạy.

## Chế độ phát triển

```sh
uv run pdftool --dev        # chỉ backend, cổng 8765
cd web && npm run dev       # Vite dev server
```

Mở http://localhost:5173.

## Kiểm thử

```sh
uv run pytest               # backend
uv run pytest -m slow       # kiểm thử hiệu năng (chậm)
cd web && npx vitest run    # unit test frontend
cd web && npm run e2e       # end-to-end, dùng Google Chrome đã cài trên máy
```

## Dữ liệu

Lưu trong `~/.pdftool` (đổi bằng biến môi trường `PDFTOOL_HOME`): file tạm, file kéo thả và cache.
Cache chứa ảnh trang đã vẽ và kết quả phân tích của các file đã mở — **kể cả file có mật khẩu**.
Mật khẩu không bao giờ được lưu. Có thể xóa thư mục này bất cứ lúc nào khi tool không chạy.

## Phím tắt

| Phím | Tác dụng |
|---|---|
| ← / → | Trang trước / trang sau |
| Delete | Xóa các trang đang chọn |
| ⌘Z / ⇧⌘Z | Hoàn tác / làm lại |
| Esc | Bỏ chọn |

## Giới hạn của bản MVP

- Ảnh CMYK, Indexed (bảng màu) và ảnh 1-bit được giữ nguyên khi nén thường; chỉ được nén lại khi bật Ghostscript.
- Chưa có OCR, chú thích (annotate) hay ký số.
