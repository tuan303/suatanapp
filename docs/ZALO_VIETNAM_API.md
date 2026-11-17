# API liên kết Zalo trên máy chủ Việt Nam

Zalo Social API định nghĩa mã `-501` là giới hạn dữ liệu do IP gọi API không nằm tại Việt Nam. Xem [bảng mã lỗi chính thức](https://docs.zaloplatforms.com/docs/Social/social-api/tham-khao/ma-loi). Địa chỉ IP cần đặt tại Việt Nam là IP đi ra của máy chủ thực hiện yêu cầu tới `graph.zalo.me`; tên miền giao diện và vị trí điện thoại không thay thế điều kiện này.

Giao diện web có thể giữ tại `https://suatanapp.vercel.app`. Gói API riêng dưới đây chỉ chạy `/api/zalo` và `/healthz`, dùng cùng handler, quy tắc xác minh và dữ liệu Firebase hiện có. Từ `LIVE-20261117.1`, máy chủ này cũng gửi thư mã xác minh liên kết Zalo qua Microsoft Graph. Không chạy các endpoint email/GAS khác hoặc phục vụ mã nguồn giao diện.

## Chuẩn bị gói API

Tại thư mục gốc repository đã có thư viện, chạy:

```shell
npm run build:zalo-api
```

Kết quả nằm trong `dist-zalo-api`, gồm `server.cjs`, package/lock runtime tối giản, cấu hình mẫu, hướng dẫn và `SHA256SUMS.txt`. Gói chỉ cần `express`, `dotenv`, `firebase-admin`; thư gửi bằng `fetch` có sẵn của Node, không thêm thư viện. Không cần thư viện giao diện hoặc chạy build trên VPS. File `.env` thật, App Secret, client secret và khóa Firebase không được đóng gói. Không dùng thư mục `agent/config.json` cho API này.

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
# Thư mã xác minh liên kết Zalo (từ LIVE-20261117.1): cùng app Entra đang gửi thư của trường.
MS_GRAPH_TENANT_ID=
MS_GRAPH_CLIENT_ID=
MS_GRAPH_CLIENT_SECRET=
MS_GRAPH_SENDER=
```

`FIREBASE_ADMIN_CREDENTIALS_JSON` là một dòng JSON service account của đúng project `dkan-4b061`; service account này phải đọc được và **cập nhật** được người dùng Firebase Authentication (xem mục cập nhật bên dưới). Bốn biến `MS_GRAPH_*` lấy từ cùng app Entra đang gửi thư trên Vercel; `MS_GRAPH_SENDER` phải là hộp thư `@hoangmaistarschool.edu.vn`. Thiếu `MS_GRAPH_*` thì chỉ bước gửi/nhập mã báo `email_link_unavailable`; đăng nhập Zalo đã liên kết và nghiệp vụ vẫn chạy. Không cần khóa riêng cho mã: máy chủ suy khóa băm mã từ `ZALO_APP_SECRET_KEY` (đổi App Secret thì mã đang chờ mất hiệu lực, người dùng gửi mã mới).

Trên nền tảng quản lý service, có thể đặt các biến trực tiếp thay vì dùng `.env`. Giữ khóa trong cấu hình máy chủ và giới hạn quyền đọc cho tài khoản chạy service.

Chạy từ thư mục chứa `.env` và `node_modules`:

```shell
node .\server.cjs
```

Mặc định chỉ lắng nghe tại `127.0.0.1:3031`. `HOST` chỉ nhận các địa chỉ loopback hoặc wildcard hợp lệ; chỉ dùng wildcard khi mô hình mạng đã có lớp bảo vệ phù hợp. Khi khởi động thành công, log ghi `DKAN_ZALO_API_READY`. Liveness `GET http://127.0.0.1:3031/healthz` trả `{"status":"ok"}`; kết quả này chưa xác nhận Zalo, Firebase hoặc Microsoft Graph đã kết nối thành công.

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

Service cần kết nối HTTPS đi ra Zalo, Google (Firebase) và Microsoft (`login.microsoftonline.com`, `graph.microsoft.com`), và có IP đi ra được Zalo nhận diện ở Việt Nam. API riêng luôn xác minh tại máy chủ này, bỏ qua biến chuyển tiếp `DKAN_ZALO_API_UPSTREAM_URL` nếu biến đó vô tình được sao chép từ Vercel. Không dùng VPN/proxy không rõ nguồn để chuyển tiếp token.

## Chuyển luồng từ Vercel

Chưa đổi luồng production khi API Việt Nam chưa sẵn sàng. Sau khi DNS, HTTPS và API độc lập thành công, mở Vercel → dự án `suatanapp` → Settings → Environment Variables. Giữ `DKAN_ZALO_ENABLED=true`, thêm biến server-only sau ở Production, rồi **Redeploy**:

```dotenv
DKAN_ZALO_API_UPSTREAM_URL=https://api-suatan.nshm.vn/api/zalo
```

Adapter chỉ chấp nhận đúng URL này, giữ nguyên kiểm tra origin/bearer/JSON, không theo redirect và không quay về gọi Graph ở Vercel khi upstream lỗi. Toàn bộ RPC liên kết tiếp tục dùng Firebase `dkan-4b061` trên backend Việt Nam. Vì đường dẫn ngoài vẫn là `https://suatanapp.vercel.app/api/zalo`, website và Mini App không cần thay URL. Không đặt biến upstream trên VPS.

App Secret, JSON Firebase và `MS_GRAPH_*` cần cấu hình đúng trên VPS. Không xóa cấu hình Vercel cũ trước khi đã kiểm tra chuyển luồng thành công. Nếu cần trở lại cấu hình cũ, bỏ biến upstream trên Vercel và Redeploy; lưu ý Vercel vẫn gặp giới hạn Zalo `-501` khi gọi Graph từ IP ngoài Việt Nam.

Kiểm tra sau khi chuyển:

1. `OPTIONS /api/zalo` với origin `https://h5.zdn.vn` được phản hồi đúng CORS.
2. `POST /api/zalo` không có bearer bị từ chối; không bỏ xác minh để thử kết nối.
3. Mở Mini App và xác nhận yêu cầu thực sự tới máy chủ Việt Nam (tài khoản đã liên kết tự đăng nhập).
4. Thử liên kết bằng mã email với tài khoản thử nghiệm theo [danh sách kiểm thử trên thiết bị](ZALO_DEVICE_TEST.md); chỉ tạo phiên khi Zalo xác minh thành công.

Hai lệnh kiểm tra không dùng token thật, không gửi email hoặc ghi dữ liệu:

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:3031/healthz
curl.exe -i -X OPTIONS https://api-suatan.nshm.vn/api/zalo -H "Origin: https://h5.zdn.vn"
```

Lệnh thứ nhất phải trả `status: ok`; lệnh thứ hai phải trả HTTP 204 và `Access-Control-Allow-Origin: https://h5.zdn.vn`. Chỉ kiểm tra được lớp HTTP/CORS; kết quả liên kết trên điện thoại mới xác nhận xác minh Zalo và gửi thư thật.

## Cập nhật LIVE-20261117.1 (liên kết bằng mã email)

CBGV-NV nhập email trường trong Mini App → máy chủ gửi mã 6 số → nhập mã là liên kết và đăng nhập xong; các lần sau Mini App tự đăng nhập. Luồng website/QR vẫn chạy song song. Làm đúng thứ tự: **VPS → Vercel → Mini App**. Hai bước đầu không ảnh hưởng bản Mini App cũ (bản cũ không gọi thao tác mới); Mini App mới chỉ deploy khi cả hai đã xong.

### 1. Microsoft Entra: quyền gửi thư

Dùng lại app Entra đang gửi thư của trường (biến `MS_GRAPH_*` trên Vercel). App cần quyền **Application** `Mail.Send` của Microsoft Graph đã **Grant admin consent** — đã có nếu thư cảnh báo/khảo sát đang gửi được. Nếu Exchange giới hạn app chỉ gửi từ một số hộp thư (Application Access Policy hoặc RBAC for Applications), đặt `MS_GRAPH_SENDER` đúng hộp thư đang dùng trên Vercel.

Vercel không cho xem lại giá trị biến đã lưu dạng Sensitive. Nếu không còn giữ client secret, tạo secret mới ở Entra → App registrations → app gửi thư → Certificates & secrets, chỉ dán vào `.env` trên VPS và ghi lại ngày hết hạn; secret trên Vercel vẫn dùng tiếp. Secret hết hạn thì bước gửi mã báo lỗi máy chủ, người đã liên kết vẫn đăng nhập được.

### 2. Firebase: quyền cập nhật người dùng Auth

Máy chủ tra tài khoản theo email (`getUserByEmail`) và đặt `emailVerified` (`updateUser`). Service account mặc định `firebase-adminsdk-…@dkan-4b061.iam.gserviceaccount.com` tải từ Firebase Console đã có quyền này. Nếu `FIREBASE_ADMIN_CREDENTIALS_JSON` là service account tự tạo với quyền hẹp, vào Google Cloud Console → IAM của project `dkan-4b061`, tìm đúng `client_email` trong JSON (không dán khóa vào đâu khác) và thêm vai trò **Firebase Authentication Admin** (`roles/firebaseauth.admin`). Thiếu quyền thì Mini App báo lỗi máy chủ sau khi nhập đúng mã; sửa xong nhập lại đúng mã đó trong 10 phút là được.

Không cần sửa Firestore rules hay tạo index: hai collection mới `zalo_link_otps`, `zalo_link_otp_limits` chỉ máy chủ đọc/ghi bằng Admin SDK như các collection `zalo_link_*` khác; rules hiện tại không có quy tắc nào cho chúng nên client bị từ chối. Mã đã dùng hoặc gửi lỗi không còn trong tài liệu `zalo_link_otps`; tài liệu chỉ giữ thời điểm gửi để tính giới hạn, không cần xóa tay.

### 3. VPS: thay server.cjs và bổ sung .env

1. Trên máy phát triển: `npm run build:zalo-api`, chép thư mục `dist-zalo-api` (hoặc bản nén) lên VPS vào một thư mục tạm.
2. Trên VPS dừng task `DKAN - Zalo API` (hoặc **Ctrl+C** ở cửa sổ đang chạy `node .\server.cjs`), sao lưu bản cũ:

```powershell
Set-Location C:\DKAN-Zalo-API
Copy-Item -LiteralPath .\server.cjs -Destination .\server.before-otp.cjs
Copy-Item -LiteralPath .\Start-Api.ps1 -Destination .\Start-Api.before-otp.ps1
```

3. Chép `server.cjs` mới vào `C:\DKAN-Zalo-API`. Đối chiếu `(Get-FileHash .\server.cjs -Algorithm SHA256).Hash` với dòng `server.cjs` trong `SHA256SUMS.txt` của gói (so không phân biệt hoa/thường). Chép cả `Start-Api.ps1` mới của gói đè lên bản cũ: bản cũ chuyển hướng log bằng PowerShell, và trên Windows PowerShell 5.1 dòng cảnh báo đầu tiên của node (`DKAN_ZALO_VERIFY_FAILED`, `DKAN_ZALO_MAIL_*`) làm script dừng, kéo theo API; bản mới chuyển hướng qua `cmd.exe`, log thành UTF-8 (đổi tên `logs\api.log` cũ trước khi chạy để không lẫn UTF-16). Bản này không thêm thư viện: giữ nguyên `node_modules`, chứng chỉ, IIS/Caddy.
4. Mở `notepad .env`, thêm bốn dòng `MS_GRAPH_*` như mẫu ở trên với giá trị thật. Không chép `.env.example` đè lên `.env`.
5. Chạy lại task (hoặc `node .\server.cjs`), kiểm tra `DKAN_ZALO_API_READY` và `/healthz` như trên.

`/healthz` không kiểm tra thư. Sau lần thử gửi mã đầu tiên, xem `logs\api.log`; hai dòng chẩn đoán chỉ chứa tên biến hoặc mã cố định, không có giá trị khóa, địa chỉ hay mã xác minh:

- `DKAN_ZALO_MAIL_UNAVAILABLE {"missing":[…],"invalid":[…]}`: biến `MS_GRAPH_*` nào thiếu/sai. `MS_GRAPH_CLIENT_ID` phải là GUID, `MS_GRAPH_TENANT_ID` là GUID hoặc tên miền tenant, giá trị mẫu kiểu `your_…_here` bị coi là sai. Sửa `.env` rồi khởi động lại task.
- `DKAN_ZALO_MAIL_FAILED {"code":…,"httpStatus":…}`: `token_failed` thường là sai tenant/client ID hoặc client secret sai/hết hạn; `send_failed` 403 thường là app thiếu `Mail.Send` hoặc hộp thư gửi ngoài phạm vi được phép, 404 là hộp thư gửi không tồn tại; `token_timeout`/`send_timeout` là VPS không ra được Microsoft.

Quay lại bản cũ: dừng task, chép `server.before-otp.cjs` thành `server.cjs`, chạy lại; bốn dòng `MS_GRAPH_*` để nguyên không ảnh hưởng bản cũ.

### 4. Vercel: Redeploy

Đưa mã nguồn lên nhánh `main` của `tuan303/suatanapp` và **Redeploy** Production. Bản Vercel cũ chặn hai thao tác mới `mini.requestOtp`, `mini.verifyOtp` và không chuyển đúng các mã lỗi mới `otp_invalid`, `otp_expired`, `account_not_found`, `email_link_unavailable`, vì `api/zalo.ts` và adapter upstream chỉ cho qua danh sách cố định. Không cần thêm biến mới trên Vercel: Vercel chỉ chuyển tiếp, thư được gửi từ VPS.

### 5. Mini App: deploy LIVE-20261117.1

Build và deploy theo bước 3 của [hướng dẫn dữ liệu thật](ZALO_LIVE_DATA.md), kiểm tra dòng `Phiên bản: LIVE-20261117.1`, rồi chạy [danh sách kiểm thử trên thiết bị](ZALO_DEVICE_TEST.md) trước khi đưa bản Testing cho CBGV-NV.

### Vì sao được đặt emailVerified

Firebase không tự coi email Microsoft dùng tên miền riêng của trường là đã xác minh, trong khi mọi lần Mini App đọc hồ sơ đều kiểm tra lại `emailVerified`. Đường dẫn xác minh của chính Firebase chỉ chứng minh một điều: người dùng đọc được thư gửi tới hộp thư đó. Mã 6 số chứng minh đúng điều này, nên sau khi mã khớp, máy chủ đặt `emailVerified=true` bằng Admin SDK — tương đương việc người dùng bấm đường dẫn của Firebase.

Giới hạn đi kèm: mã chỉ gửi tới địa chỉ của chính tài khoản trường, tài khoản phải còn hoạt động, đúng tên miền và từng đăng nhập bằng Microsoft; máy chủ chỉ lưu bản băm HMAC của mã, không ghi mã vào log; mã hết hạn sau 10 phút, sai 5 lần là hủy, và mỗi tài khoản chỉ được nhập sai tổng cộng 10 lần trong 24 giờ dù từ bao nhiêu Zalo (sau đó mọi mã của tài khoản bị từ chối, chủ tài khoản liên kết qua website); gửi lại sau 60 giây, tối đa 5 thư/giờ và 10 thư/24 giờ cho mỗi Zalo và mỗi tài khoản. Cờ chỉ được đặt cho đúng UID đã nhận mã, sau khi mã khớp, và tài khoản được kiểm tra lại (còn hoạt động, đúng tên miền, đăng nhập Microsoft) ngay trước khi đặt. `firestore.rules` hiện không dựa vào `email_verified`, nên cờ này chỉ ảnh hưởng các bước liên kết Zalo (trang `/lien-ket-zalo` thôi yêu cầu thư xác minh cho tài khoản đó). Mỗi lần liên kết thành công, hộp thư còn nhận thư báo kèm cách hủy liên kết nếu không phải chủ tài khoản. Không sửa tay `emailVerified` hoặc cấp quyền quản trị để bỏ qua bước này.

Không gửi access token, mã xác minh, App Secret, client secret hoặc JSON Firebase qua chat/log. Hướng dẫn cập nhật các bản trước (`LIVE-20261103.1` nghiệp vụ thật, `LIVE-20261116.2` nút/QR trên website): [hướng dẫn dữ liệu thật](ZALO_LIVE_DATA.md).

Bản `LIVE-20261116.3` mở trang xác minh Microsoft bằng WebView của Zalo hoặc qua trình duyệt khi người dùng sao chép địa chỉ. Từ `LIVE-20261117.1`, nút mở trang và nút **Sao chép địa chỉ** nằm trong mục **Cách khác: liên kết qua website** của Mini App. [Kiểm thử trên thiết bị](ZALO_DEVICE_TEST.md)
