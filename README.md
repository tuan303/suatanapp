# Suất ăn Ngôi Sao Hoàng Mai

Mã nguồn phần mềm đăng ký suất ăn của nhà trường, kèm bản phát triển Zalo Mini App. Repository: [tuan303/suatanapp](https://github.com/tuan303/suatanapp).

## Cấu trúc

| Thư mục | Nội dung |
| --- | --- |
| `src/` | Website đăng ký ăn, quản trị và trang liên kết tài khoản `/lien-ket-zalo` |
| `api/` | API email và API liên kết Zalo `/api/zalo` chạy phía máy chủ |
| `miniapp/` | Giao diện Zalo Mini App, kiểm thử và mã xác thực/liên kết tài khoản dùng chung với API |
| `agent/` | Agent đồng bộ lượt chấm ăn từ thiết bị HAC và gửi thông báo theo lịch |
| `tests/` | Kiểm thử của website và API |

## Trạng thái bản Zalo

- Mini App ID: `3378419117469948059`.
- Zalo App ID cha: `928403133949225802`.
- Đã có mã xác minh danh tính Zalo phía server, liên kết với tài khoản nhà trường, phiên API cá nhân và hủy liên kết.
- Liên kết Microsoft/Zalo đã được kiểm tra thành công trên điện thoại. API công khai ở `https://suatanapp.vercel.app` chuyển tiếp tới máy chủ Việt Nam `api-suatan.nshm.vn`.
- Bản `LIVE-20261103.1` đã có API dữ liệu thật cho đăng ký tháng, hủy ăn, sự kiện, thực đơn, chấm ăn cá nhân và khảo sát. Mã nghiệp vụ dùng chung dữ liệu với website; cần cập nhật API trên VPS và deploy lại Mini App để sử dụng bản này.
- Bản `LIVE-20261116.2` hỗ trợ liên kết bằng nút mở trong Zalo hoặc quét QR từ website.
- Bản `LIVE-20261117.1` (đang chuẩn bị): CBGV-NV liên kết ngay trong Mini App — nhập email trường, nhập mã 6 số gửi về hộp thư là xong; các lần mở sau tự đăng nhập. Đường website/QR vẫn giữ làm cách thay thế. Cần cập nhật VPS (`server.cjs` + `MS_GRAPH_*`), Vercel rồi Mini App theo [hướng dẫn API Việt Nam](docs/ZALO_VIETNAM_API.md). [Hướng dẫn kiểm thử trên điện thoại](docs/ZALO_DEVICE_TEST.md)
- Xem [hướng dẫn chuyển sang dữ liệu thật](docs/ZALO_LIVE_DATA.md). Việc kiểm thử ngoại tuyến và build thành công không thay thế kiểm tra trên Zalo sau khi triển khai.

Đọc [hướng dẫn Mini App](miniapp/README.md) để cấu hình và chạy thử. Lần đầu, Thầy/Cô xác minh quyền dùng hộp thư trường bằng mã gửi qua email để liên kết đúng hồ sơ (điều kiện: đã đăng nhập website suất ăn bằng Microsoft ít nhất một lần); các lần đăng nhập Mini App sau dùng danh tính Zalo đã liên kết.

Bước thử nghiệm trên điện thoại: [hướng dẫn Device Mode / Testing và liên kết một tài khoản](docs/ZALO_DEVICE_TEST.md).

Zalo Social mã `-501` yêu cầu IP máy chủ gọi Graph phải nằm ở Việt Nam. Đã chuẩn bị [gói API riêng cho Windows Server](docs/ZALO_VIETNAM_API.md) tại `api-suatan.nshm.vn`; chỉ bật `DKAN_ZALO_API_UPSTREAM_URL` trên Vercel sau khi DNS, HTTPS và API mới đã được kiểm tra. Giao diện và địa chỉ ngoài của Mini App được giữ nguyên khi chuyển API.

## Chạy trên máy tính

Website và API, tại thư mục gốc:

```powershell
npm ci --ignore-scripts
npm run dev
```

Website chạy tại `http://localhost:3000`. Mặc định chức năng liên kết Zalo bị tắt cho tới khi cấu hình máy chủ đầy đủ.

Mini App, tại thư mục `miniapp`:

```powershell
cd miniapp
npm ci --ignore-scripts
npm run dev
```

Bản mẫu chạy tại `http://127.0.0.1:4930`. Dừng các phiên dev/preview bằng `Ctrl+C` trước khi cài lại thư viện để tránh Windows khóa tệp `esbuild.exe`. Khi đã cài thư viện, những lần mở sau chỉ cần `npm run dev` trong đúng thư mục. Đăng nhập Zalo cần kiểm thử trong môi trường Zalo thật, qua Device Mode hoặc bản Testing.

## Triển khai

Website/API dùng thư mục gốc của repository, lệnh build `npm run build`, thư mục đầu ra `dist`. Zalo Mini App có lệnh build riêng trong `miniapp`: `npm run build`, đầu ra `www`; không dùng `www` làm đầu ra của website trường.

Cấu hình các biến trong `.env.example` trên máy chủ/Vercel. Để thử liên kết thật cần `ZALO_APP_ID`, `ZALO_MINI_APP_ID`, `ZALO_APP_SECRET_KEY`, `FIREBASE_ADMIN_CREDENTIALS_JSON` của project Firebase `dkan-4b061` và `DKAN_ZALO_ENABLED=true`; giữ cờ tắt trong lúc chuẩn bị. Liên kết bằng mã email cần thêm bốn biến `MS_GRAPH_*` trên máy chủ chạy API Zalo (VPS Việt Nam), cùng app Entra gửi thư của trường, và service account Firebase được cập nhật người dùng Auth. Sau khi đổi biến môi trường cần triển khai lại.

API sản xuất cho phép hai website cố định `https://dkan.nshm.vn`, `https://suatanapp.vercel.app` và Mini App origin `https://h5.zdn.vn`. Mini App dùng `VITE_DKAN_API_ORIGIN=https://suatanapp.vercel.app`; trang liên kết/hủy liên kết qua website thuộc cùng origin API tại `/lien-ket-zalo`. Không cho phép mọi tên miền `*.vercel.app` hoặc các URL preview. Website DKAN hiện có tiếp tục dùng tên miền trường.

Khi đăng nhập Microsoft trên website mới, cấu hình `suatanapp.vercel.app` trong Firebase Authentication → Settings → Authorized domains nếu tên miền này chưa có. Thử Mini App bằng Device Mode hoặc bản Testing trong Zalo; trình duyệt máy tính dùng để kiểm tra giao diện.

Không đưa khóa bí mật vào `VITE_*`, mã client hoặc Git. Repository chỉ chứa cấu hình mẫu; các tệp `.env` thật, service account, `agent/config.json`, `node_modules` và đầu ra build được loại khỏi Git.

## Kiểm tra

Tại thư mục gốc:

```powershell
npm run lint
npm test
npm run build
```

Tại `miniapp`:

```powershell
npm run typecheck
npm test
npm run build
```

Các kiểm thử Zalo sử dụng danh tính, token, dịch vụ gửi thư và dữ liệu giả lập; không gửi email hoặc ghi dữ liệu vận hành. `test-email.cjs` là công cụ gửi thư thật thủ công, không thuộc lệnh `npm test`.

- Bản `LIVE-20261116.3` mở trang xác minh Microsoft bằng WebView của Zalo và hiển thị địa chỉ để mở bằng Chrome hoặc Safari. Từ bản `LIVE-20261117.1`, nút mở trang và nút **Sao chép địa chỉ** nằm trong mục **Cách khác: liên kết qua website**; đường chính là mã gửi qua email trường.
