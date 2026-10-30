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
- Đã có mã xác minh danh tính Zalo phía server, liên kết với hồ sơ Microsoft của trường bằng mã một lần và xác nhận trên web, phiên API cá nhân và hủy liên kết.
- Các tab đăng ký, hủy ăn, thực đơn, sự kiện và khảo sát trong Mini App hiện dùng **dữ liệu minh họa**; chưa nối các API nghiệp vụ thật.
- Việc đưa mã lên GitHub không tự cấu hình Vercel, tạo phiên bản Testing hoặc phát hành Mini App. Chưa xác nhận đăng nhập Microsoft/Zalo thật trong bản này.

Đọc [hướng dẫn Mini App](miniapp/README.md) để cấu hình và chạy thử. Lần đầu người dùng xác minh tài khoản Microsoft của trường để liên kết đúng hồ sơ; các lần đăng nhập Mini App sau dùng danh tính Zalo đã liên kết.

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

Cấu hình các biến trong `.env.example` trên máy chủ/Vercel. Để thử liên kết thật cần `ZALO_APP_ID`, `ZALO_MINI_APP_ID`, `ZALO_APP_SECRET_KEY`, `FIREBASE_ADMIN_CREDENTIALS_JSON` của project Firebase `dkan-4b061` và `DKAN_ZALO_ENABLED=true`; giữ cờ tắt trong lúc chuẩn bị. Sau khi đổi biến môi trường cần triển khai lại.

API sản xuất hiện cho phép website `https://dkan.nshm.vn` và Mini App origin `https://h5.zdn.vn`. Mini App chỉ đặt `VITE_DKAN_API_ORIGIN=https://dkan.nshm.vn` sau khi API đã hoạt động. Nếu chuyển nguồn Git của dự án Vercel đang vận hành sang repository này, kiểm tra đúng project, biến môi trường và tên miền trước khi triển khai. Một tên miền preview `*.vercel.app` riêng chưa đáp ứng cấu hình origin hiện tại.

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

Các kiểm thử Zalo sử dụng danh tính, token và dữ liệu giả lập; không gửi email hoặc ghi dữ liệu vận hành. `test-email.cjs` là công cụ gửi thư thật thủ công, không thuộc lệnh `npm test`.
