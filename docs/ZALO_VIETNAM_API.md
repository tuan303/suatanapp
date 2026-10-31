# API liên kết Zalo trên máy chủ Việt Nam

Zalo Social API định nghĩa mã `-501` là giới hạn dữ liệu do IP gọi API không nằm tại Việt Nam. Xem [bảng mã lỗi chính thức](https://docs.zaloplatforms.com/docs/Social/social-api/tham-khao/ma-loi). Địa chỉ IP cần đặt tại Việt Nam là IP đi ra của máy chủ thực hiện yêu cầu tới `graph.zalo.me`; tên miền giao diện và vị trí điện thoại không thay thế điều kiện này.

Giao diện web có thể giữ tại `https://suatanapp.vercel.app`. Gói API riêng dưới đây chỉ chạy `/api/zalo` và `/healthz`, dùng cùng handler, quy tắc xác minh và dữ liệu Firebase hiện có. Không chạy các endpoint email/GAS hoặc phục vụ mã nguồn giao diện.

## Chuẩn bị gói API

Tại thư mục gốc repository đã có thư viện, chạy:

```shell
npm run build:zalo-api
```

Kết quả nằm trong `dist-zalo-api`, gồm `server.cjs`, package/lock runtime tối giản, cấu hình mẫu, hướng dẫn và `SHA256SUMS.txt`. Gói chỉ cần `express`, `dotenv`, `firebase-admin`; không cần thư viện giao diện hoặc chạy build trên VPS. File `.env` thật, App Secret và khóa Firebase không được đóng gói. Không dùng thư mục `agent/config.json` cho API này.

Trên **Windows Server Việt Nam**:

1. Cài [Node.js LTS cho Windows](https://nodejs.org/en/download) nếu máy chưa có Node 22.12 trở lên.
2. Giải nén gói API vào một thư mục riêng, ví dụ `C:\DKAN-Zalo-API`. Đây là dịch vụ khác với `C:\DKAN-Agent`; không chép đè vào thư mục agent.
3. Mở PowerShell trong thư mục vừa giải nén và chạy:

```powershell
cd C:\DKAN-Zalo-API
npm ci --omit=dev --ignore-scripts
Copy-Item -LiteralPath .env.example -Destination .env
notepad .env
```

Chỉ chạy lệnh sao chép `.env.example` khi chưa có `.env`; khi cập nhật phiên bản, giữ nguyên `.env` và cấu hình service đang dùng.

Tạo cấu hình riêng trên máy chủ, không chia sẻ giá trị khóa:

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=3031
DKAN_ZALO_ENABLED=true
ZALO_APP_ID=928403133949225802
ZALO_MINI_APP_ID=3378419117469948059
ZALO_APP_SECRET_KEY=
FIREBASE_ADMIN_CREDENTIALS_JSON=
```

`FIREBASE_ADMIN_CREDENTIALS_JSON` là một dòng JSON service account của đúng project `dkan-4b061`. Trên nền tảng quản lý service, có thể đặt các biến trực tiếp thay vì dùng `.env`. Giữ khóa trong cấu hình máy chủ và giới hạn quyền đọc cho tài khoản chạy service.

Chạy từ thư mục chứa `.env` và `node_modules`:

```shell
node .\server.cjs
```

Mặc định chỉ lắng nghe tại `127.0.0.1:3031`. `HOST` chỉ nhận các địa chỉ loopback hoặc wildcard hợp lệ; chỉ dùng wildcard khi mô hình mạng đã có lớp bảo vệ phù hợp. Khi khởi động thành công, log ghi `DKAN_ZALO_API_READY`. Liveness `GET http://127.0.0.1:3031/healthz` trả `{"status":"ok"}`; kết quả này chưa xác nhận Zalo hoặc Firebase đã kết nối thành công.

## Windows Server và HTTPS

Máy chủ được chọn là Windows Server; tên miền API là `api-suatan.nshm.vn`.

1. Tạo bản ghi DNS `A` cho `api-suatan.nshm.vn` trỏ tới IPv4 công khai của VPS Việt Nam. Chỉ tạo `AAAA` khi IPv6 và tuyến vào/ra thực sự được cấu hình đúng. Khi dùng proxy DNS/CDN, IP đi ra gọi Zalo vẫn phải là IP Việt Nam của VPS.
2. Cấp chứng chỉ TLS hợp lệ cho tên miền trên. Dùng IIS reverse proxy hoặc một HTTPS reverse proxy tin cậy; chưa cài hoặc thay đổi cấu hình web server tự động trong gói này.
3. Chuyển tiếp đúng `/api/zalo` tới `http://127.0.0.1:3031/api/zalo`, giữ nguyên `Authorization`, `Origin`, `Content-Type` và phần thân JSON. Không công khai cổng 3031 trực tiếp. Giới hạn phần thân yêu cầu tại proxy; `/healthz` có thể chỉ dùng nội bộ.
4. Đăng ký tiến trình Node chạy dưới tài khoản service có quyền đọc thư mục cấu hình, tự khởi động lại sau khi Windows khởi động. Có thể dùng Task Scheduler như mô tả dưới đây.

Nếu máy chưa dùng cổng 80/443, có thể dùng [Caddy cho Windows](https://caddyserver.com/docs/install) với `Caddyfile` đi kèm. Caddy tự cấp chứng chỉ khi DNS đã trỏ đúng và cổng 80/443 từ Internet truy cập được. Chạy kiểm tra cấu hình trước, rồi đăng ký theo [hướng dẫn Windows service chính thức](https://caddyserver.com/docs/running#windows-service). Nếu IIS đang dùng các cổng này, cấu hình reverse proxy riêng cho hostname trong IIS thay vì chạy thêm Caddy trên cùng cổng. Không cần mở cổng 3031 ra Internet.

```powershell
.\caddy.exe validate --config .\Caddyfile --adapter caddyfile
.\caddy.exe run --config .\Caddyfile --adapter caddyfile
```

### Tự chạy API sau khi Windows khởi động

Trong Task Scheduler, tạo task `DKAN - Zalo API`:

- **General:** chọn tài khoản service có quyền đọc thư mục `C:\DKAN-Zalo-API` và `.env`; chọn **Run whether user is logged on or not**.
- **Triggers:** **At startup**, có thể trễ 30 giây để chờ mạng.
- **Actions → Start a program:** `powershell.exe`; **Arguments**:

```text
-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "C:\DKAN-Zalo-API\Start-Api.ps1"
```

- **Start in:** `C:\DKAN-Zalo-API`.
- **Settings:** bật tự khởi động lại mỗi 1 phút khi lỗi; bỏ giới hạn tự dừng sau vài ngày; khi task đang chạy chọn **Do not start a new instance**.
- Chọn **Run**, rồi kiểm tra `http://127.0.0.1:3031/healthz` ngay trên VPS. Log nằm ở `logs\api.log`. Task chạy liên tục nên trạng thái **Running** là bình thường.

Service cần kết nối HTTPS đi ra Zalo và Google, và có IP đi ra được Zalo nhận diện ở Việt Nam. API riêng luôn xác minh tại máy chủ này, bỏ qua biến chuyển tiếp `DKAN_ZALO_API_UPSTREAM_URL` nếu biến đó vô tình được sao chép từ Vercel. Không dùng VPN/proxy không rõ nguồn để chuyển tiếp token.

## Chuyển luồng từ Vercel

Chưa đổi luồng production khi API Việt Nam chưa sẵn sàng. Sau khi DNS, HTTPS và API độc lập thành công, mở Vercel → dự án `suatanapp` → Settings → Environment Variables. Giữ `DKAN_ZALO_ENABLED=true`, thêm biến server-only sau ở Production, rồi **Redeploy**:

```dotenv
DKAN_ZALO_API_UPSTREAM_URL=https://api-suatan.nshm.vn/api/zalo
```

Adapter chỉ chấp nhận đúng URL này, giữ nguyên kiểm tra origin/bearer/JSON, không theo redirect và không quay về gọi Graph ở Vercel khi upstream lỗi. Toàn bộ RPC liên kết tiếp tục dùng Firebase `dkan-4b061` trên backend Việt Nam. Vì đường dẫn ngoài vẫn là `https://suatanapp.vercel.app/api/zalo`, website và Mini App không cần thay URL hoặc deploy lại chỉ để chuyển API. Không đặt biến upstream trên VPS.

App Secret và JSON Firebase vẫn cần cấu hình đúng trên VPS. Không xóa cấu hình Vercel cũ trước khi đã kiểm tra chuyển luồng thành công. Nếu cần trở lại cấu hình cũ, bỏ biến upstream trên Vercel và Redeploy; lưu ý Vercel vẫn gặp giới hạn Zalo `-501` khi gọi Graph từ IP ngoài Việt Nam.

Kiểm tra sau khi chuyển:

1. `OPTIONS /api/zalo` với origin `https://h5.zdn.vn` được phản hồi đúng CORS.
2. `POST /api/zalo` không có bearer bị từ chối; không bỏ xác minh để thử kết nối.
3. Bấm kiểm tra Zalo trong Mini App và xác nhận yêu cầu thực sự tới máy chủ Việt Nam.
4. Thử toàn bộ luồng tạo mã trên web, xác nhận bằng Microsoft, liên kết và đăng nhập cá nhân; chỉ tạo phiên khi Zalo xác minh thành công.

Hai lệnh kiểm tra không dùng token thật, không gửi email hoặc ghi dữ liệu:

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:3031/healthz
curl.exe -i -X OPTIONS https://api-suatan.nshm.vn/api/zalo -H "Origin: https://h5.zdn.vn"
```

Lệnh thứ nhất phải trả `status: ok`; lệnh thứ hai phải trả HTTP 204 và `Access-Control-Allow-Origin: https://h5.zdn.vn`. Chỉ kiểm tra được lớp HTTP/CORS; kết quả liên kết trên điện thoại mới xác nhận xác minh Zalo thật.

Không gửi access token, App Secret hoặc JSON Firebase qua chat/log. Bản Mini App vẫn chỉ có dữ liệu nghiệp vụ minh họa ngoài phần liên kết tài khoản.
