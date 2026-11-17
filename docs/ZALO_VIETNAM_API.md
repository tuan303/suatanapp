# API liên kết Zalo trên máy chủ Việt Nam

Zalo Social API định nghĩa mã `-501` là giới hạn dữ liệu do IP gọi API không nằm tại Việt Nam. Xem [bảng mã lỗi chính thức](https://docs.zaloplatforms.com/docs/Social/social-api/tham-khao/ma-loi). Địa chỉ IP cần đặt tại Việt Nam là IP đi ra của máy chủ thực hiện yêu cầu tới `graph.zalo.me`; tên miền giao diện và vị trí điện thoại không thay thế điều kiện này.

Giao diện web có thể giữ tại `https://suatanapp.vercel.app`. Gói API riêng dưới đây chỉ chạy `/api/zalo`, `/api/zalo-webhook` và `/healthz`, dùng cùng handler, quy tắc xác minh và dữ liệu Firebase hiện có. Xem [hướng dẫn webhook](ZALO_WEBHOOK_SETUP.md) để cấu hình thông báo thu hồi quyền từ Zalo. Từ `LIVE-20261117.1`, máy chủ này cũng gửi thư mã xác minh liên kết Zalo qua Microsoft Graph. Không chạy các endpoint email/GAS khác hoặc phục vụ mã nguồn giao diện.

## Chuẩn bị gói API

Tại thư mục gốc repository đã có thư viện, chạy:

```shell
npm run build:zalo-api
```

Kết quả nằm trong `dist-zalo-api`, gồm `server.cjs`, package/lock runtime tối giản, cấu hình mẫu, `Install-ApiStartup.ps1` (đăng ký chạy nền), `Set-WebhookKey.ps1` (nhập khóa webhook), `web.config` mẫu cho IIS, hướng dẫn và `SHA256SUMS.txt`. Gói chỉ cần `express`, `dotenv`, `firebase-admin`; thư gửi bằng `fetch` có sẵn của Node, không thêm thư viện. Không cần thư viện giao diện hoặc chạy build trên VPS. File `.env` thật, App Secret, client secret và khóa Firebase không được đóng gói. Không dùng thư mục `agent/config.json` cho API này.

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

Chỉ chạy lệnh sao chép `.env.example` khi chưa có `.env`; khi cập nhật phiên bản, giữ các dòng hiện có của `.env` và cấu hình service đang dùng, chỉ thêm dòng mới khi mục cập nhật yêu cầu (bản `LIVE-20261117.1`: bốn dòng `MS_GRAPH_*`).

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
# Open API Key của Zalo App cha, xác minh webhook thu hồi quyền; nên nhập bằng Set-WebhookKey.ps1.
ZALO_MINI_APP_API_KEY=
# Thư mã xác minh liên kết Zalo (từ LIVE-20261117.1): cùng app Entra đang gửi thư của trường.
MS_GRAPH_TENANT_ID=
MS_GRAPH_CLIENT_ID=
MS_GRAPH_CLIENT_SECRET=
MS_GRAPH_SENDER=
```

`FIREBASE_ADMIN_CREDENTIALS_JSON` là một dòng JSON service account của đúng project `dkan-4b061`; service account này phải đọc được và **cập nhật** được người dùng Firebase Authentication (xem mục cập nhật bên dưới). Bốn biến `MS_GRAPH_*` lấy từ cùng app Entra đang gửi thư trên Vercel; `MS_GRAPH_SENDER` phải là hộp thư `@hoangmaistarschool.edu.vn`. Thiếu `MS_GRAPH_*` thì chỉ bước gửi/nhập mã báo `email_link_unavailable`; đăng nhập Zalo đã liên kết và nghiệp vụ vẫn chạy. Không cần khóa riêng cho mã: máy chủ suy khóa băm mã từ `ZALO_APP_SECRET_KEY` (đổi App Secret thì mã đang chờ mất hiệu lực, người dùng gửi mã mới).

Trên nền tảng quản lý service, có thể đặt các biến trực tiếp thay vì dùng `.env`. Giữ khóa trong cấu hình máy chủ và giới hạn quyền đọc cho tài khoản chạy service.

Có thể chạy thử trực tiếp từ thư mục chứa `.env` và `node_modules`; bấm **Ctrl+C** để dừng trước khi đăng ký chạy nền ở mục *Tự chạy API sau khi Windows khởi động* bên dưới:

```shell
node .\server.cjs
```

Mặc định chỉ lắng nghe tại `127.0.0.1:3031`. `HOST` chỉ nhận các địa chỉ loopback hoặc wildcard hợp lệ; chỉ dùng wildcard khi mô hình mạng đã có lớp bảo vệ phù hợp. Khi khởi động thành công, log ghi `DKAN_ZALO_API_READY` (chạy tay: trong cửa sổ PowerShell; chạy nền: trong `logs\api.log`). Liveness `GET http://127.0.0.1:3031/healthz` trả `{"status":"ok"}`; kết quả này chưa xác nhận Zalo, Firebase hoặc Microsoft Graph đã kết nối thành công.

## Windows Server và HTTPS

Máy chủ được chọn là Windows Server; tên miền API là `api-suatan.nshm.vn`.

1. Tạo bản ghi DNS `A` cho `api-suatan.nshm.vn` trỏ tới IPv4 công khai của VPS Việt Nam. Chỉ tạo `AAAA` khi IPv6 và tuyến vào/ra thực sự được cấu hình đúng. Khi dùng proxy DNS/CDN, IP đi ra gọi Zalo vẫn phải là IP Việt Nam của VPS.
2. Cấp chứng chỉ TLS hợp lệ cho tên miền trên. Dùng IIS reverse proxy hoặc một HTTPS reverse proxy tin cậy; chưa cài hoặc thay đổi cấu hình web server tự động trong gói này.
3. Chuyển tiếp đúng `/api/zalo` và `/api/zalo-webhook` tới cùng đường dẫn trên `http://127.0.0.1:3031`, giữ nguyên `Authorization`, `Origin`, `Content-Type`, `X-ZEvent-Signature` và phần thân JSON. Không công khai cổng 3031 trực tiếp. Giới hạn phần thân yêu cầu tại proxy; `/healthz` có thể chỉ dùng nội bộ. Gói có `web.config` mẫu cho site proxy IIS (URL Rewrite + ARR) chỉ chuyển hai đường dẫn này; cách cập nhật site đang chạy xem [hướng dẫn webhook](ZALO_WEBHOOK_SETUP.md).
4. Đăng ký API chạy nền bằng `Install-ApiStartup.ps1` như mô tả dưới đây: tài khoản Local Service, tự chạy khi Windows khởi động, ghi log vào `logs\api.log`.

Nếu máy chưa dùng cổng 80/443, có thể dùng [Caddy cho Windows](https://caddyserver.com/docs/install) với `Caddyfile` đi kèm. Caddy tự cấp chứng chỉ khi DNS đã trỏ đúng và cổng 80/443 từ Internet truy cập được. Chạy kiểm tra cấu hình trước, rồi đăng ký theo [hướng dẫn Windows service chính thức](https://caddyserver.com/docs/running#windows-service). Nếu IIS đang dùng các cổng này, cấu hình reverse proxy riêng cho hostname trong IIS thay vì chạy thêm Caddy trên cùng cổng. Không cần mở cổng 3031 ra Internet.

```powershell
.\caddy.exe validate --config .\Caddyfile --adapter caddyfile
.\caddy.exe run --config .\Caddyfile --adapter caddyfile
```

### Tự chạy API sau khi Windows khởi động

Cách chính là tác vụ `DKAN - Zalo API` do `Install-ApiStartup.ps1` (có trong gói) đăng ký. Đặt tệp này vào `C:\DKAN-Zalo-API`, cạnh `server.cjs`, `.env` và `node_modules`. Mở một cửa sổ PowerShell mới bằng **Run as administrator** rồi chạy:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\DKAN-Zalo-API\Install-ApiStartup.ps1"
```

Tác vụ chạy Node bằng tài khoản **Local Service** khi Windows khởi động, dùng đường dẫn tuyệt đối đến `node.exe`, nạp `.env` bằng `--env-file` và chạy liên tục (trạng thái **Running** là bình thường). Khi tiến trình thoát do lỗi, Task Scheduler thử chạy lại sau 1 phút, tối đa 10 lần. Node được chạy qua `cmd.exe` để ghi toàn bộ đầu ra vào `logs\api.log` (UTF-8): Task Scheduler không giữ đầu ra của tiến trình, nên các dòng chẩn đoán `DKAN_ZALO_*` chỉ có trong tệp này. Local Service chỉ được đọc các tệp API cần và chỉ được ghi trong thư mục `logs`.

Khi thấy `API DANG CHAY NEN - healthz: ok`, có thể đóng PowerShell. Nếu báo cổng 3031 đang được dùng bởi API chạy tay, bấm **Ctrl+C** trong đúng cửa sổ đang chạy Node rồi chạy lại lệnh cài đặt. Nếu báo chưa xác nhận được API, xem cuối `logs\api.log` (ví dụ `DKAN_ZALO_API_START_FAILED`) và **Last Run Result** của tác vụ trong Task Scheduler. Sau lần khởi động lại Windows, kiểm tra tác vụ ở trạng thái **Running** và dùng `Invoke-RestMethod -Uri http://127.0.0.1:3031/healthz` ngay trên VPS.

**Chạy lại lệnh cài đặt sau mỗi lần thay `server.cjs` hoặc sửa `.env`** (kể cả sau `Set-WebhookKey.ps1`). Lệnh tự dừng API đang chạy, cấp lại quyền đọc cho Local Service trên tệp vừa chép, đăng ký lại tác vụ, chạy lại API rồi kiểm tra `/healthz`; API gián đoạn vài giây. Tệp mới chép vào thư mục không mang quyền của tệp cũ, nên nếu chỉ bấm **Run** trong Task Scheduler, tác vụ có thể không đọc được `server.cjs` mới.

Để dừng hẳn API, chạy cùng lệnh với tham số `-Stop` (tác vụ vẫn tự chạy lại khi Windows khởi động). Không dùng **End** trong Task Scheduler để dừng API: End dừng `cmd.exe` của tác vụ nhưng có thể để lại `node.exe` vẫn chạy bản cũ và giữ cổng 3031.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\DKAN-Zalo-API\Install-ApiStartup.ps1" -Stop
```

Xem log bằng `Get-Content -LiteralPath C:\DKAN-Zalo-API\logs\api.log -Tail 50 -Encoding UTF8`. Các dòng `DKAN_ZALO_*` chỉ chứa tên biến, bước xử lý và mã lỗi cố định; vẫn không gửi toàn bộ log qua chat. Log chỉ có dòng mới khi khởi động hoặc gặp lỗi. Mỗi mã chẩn đoán ghi tối đa 20 dòng mỗi phút (yêu cầu kèm token rác cũng tạo dòng `DKAN_ZALO_VERIFY_FAILED`); phần vượt được gộp thành một dòng `<mã>_SUPPRESSED {"count":n}`, chỉ có số dòng bị bỏ. Mỗi lần chạy, lệnh cài đặt đổi tên `logs\api.log` lớn hơn 20 MB thành `api-yyyyMMdd-HHmmss.log` và chỉ giữ 5 tệp như vậy gần nhất. Muốn làm mới sớm hơn, dừng bằng `-Stop`, đổi tên tệp rồi chạy lại lệnh cài đặt. Nếu `logs\api.log` cũ là UTF-16 (do `Start-Api.ps1` bản cũ ghi), lệnh cài đặt tự đổi tên thành `api.utf16-….log` để log mới không lẫn mã hóa.

`Start-Api.ps1` chỉ dùng để chạy tay hoặc dự phòng trong một cửa sổ PowerShell (cũng ghi `logs\api.log` qua `cmd.exe`). Dừng tác vụ bằng `-Stop` trước khi dùng, vì cả hai cùng cổng 3031; không tạo thêm tác vụ Task Scheduler gọi `Start-Api.ps1`.

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

Không cần sửa Firestore rules hay tạo index: hai collection mới `zalo_link_otps`, `zalo_link_otp_limits` chỉ máy chủ đọc/ghi bằng Admin SDK như các collection `zalo_link_*` khác; rules hiện tại không có quy tắc nào cho chúng nên client bị từ chối. Mã đã dùng hoặc gửi lỗi không còn trong tài liệu `zalo_link_otps`; tài liệu chỉ giữ thời điểm gửi để tính giới hạn, không cần xóa tay. Webhook thu hồi quyền ghi `zalo_link_revocations` (khóa băm; giữ thêm tối đa 10 thời điểm gửi mã trong 24 giờ gần nhất để giới hạn thư theo Zalo không bị đặt lại khi thu hồi rồi cấp quyền lại), `zalo_webhook_events` cũng chỉ qua Admin SDK; danh sách miễn chấm `meal_checkin_exemptions` được đọc bằng Admin SDK với truy vấn một trường `email ==`, dùng chỉ mục đơn mặc định.

### 3. VPS: thay server.cjs, Install-ApiStartup.ps1 và bổ sung .env

VPS đang chạy tác vụ `DKAN - Zalo API` do bản `Install-ApiStartup.ps1` trước đăng ký (Node chạy trực tiếp, không có log) với `server.cjs` đã có webhook thu hồi quyền. Bản này giữ webhook, thêm thư mã xác minh và áp dụng danh sách miễn chấm ăn theo bữa khi đọc lịch sử chấm ăn ([chi tiết](MEAL_CHECKIN_EXEMPTIONS.md); Mini App đang chạy đã đọc được trạng thái **Miễn chấm ăn**), và `Install-ApiStartup.ps1` mới thay tác vụ cũ (cùng tên, cùng mô tả) bằng tác vụ ghi `logs\api.log`. Không thêm thư viện: giữ nguyên `node_modules`, `.env` hiện có (kể cả `ZALO_MINI_APP_API_KEY` của webhook), chứng chỉ, IIS/`web.config`.

**Kiểm tra trước khi thay `server.cjs`:** API mới trả trạng thái **Miễn chấm ăn** mà bản `LIVE-20261103.1` (và cũ hơn) không đọc được: bản đó báo lỗi cả màn hình dữ liệu của người có bữa được miễn. Trên trang quản lý Mini App (`https://mini.zalo.me/developers/`), xác nhận **cả** bản đang phát hành **và** bản Testing đều từ `LIVE-20261106.1` trở lên (theo mô tả phiên bản, hoặc dòng `Phiên bản:` khi mở bản đó trong Zalo). Nếu còn bản cũ hơn, chưa thay API: đưa bản từ `LIVE-20261106.1` trở lên (ví dụ `LIVE-20261116.3` đang chạy) lên đúng kênh đó trước.

1. Trên máy phát triển: `npm run build:zalo-api`, chép thư mục `dist-zalo-api` (hoặc bản nén) lên VPS vào một thư mục tạm.
2. Trên VPS mở PowerShell bằng **Run as administrator** (dùng cửa sổ này cho các bước sau) và sao lưu bản đang chạy:

```powershell
Set-Location C:\DKAN-Zalo-API
Copy-Item -LiteralPath .\server.cjs -Destination .\server.before-otp.cjs
```

3. Chép `Install-ApiStartup.ps1` và `Start-Api.ps1` mới của gói đè lên bản cũ trong `C:\DKAN-Zalo-API`, rồi dừng API và chờ dòng `API DA DUNG`:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\DKAN-Zalo-API\Install-ApiStartup.ps1" -Stop
```

4. Chép `server.cjs` mới vào `C:\DKAN-Zalo-API`. Đối chiếu `(Get-FileHash .\server.cjs -Algorithm SHA256).Hash` và `(Get-FileHash .\Install-ApiStartup.ps1 -Algorithm SHA256).Hash` với dòng tương ứng trong `SHA256SUMS.txt` của gói (so không phân biệt hoa/thường).
5. Mở `notepad .env`, thêm bốn dòng `MS_GRAPH_*` như mẫu ở trên với giá trị thật, giữ nguyên các dòng khác. Không chép `.env.example` đè lên `.env`.
6. Chạy lại lệnh cài đặt (không kèm `-Stop`) và chờ `API DANG CHAY NEN - healthz: ok`. Lệnh cấp quyền đọc cho Local Service trên `server.cjs` mới, tạo `logs` (đổi tên `logs\api.log` lớn hơn 20 MB, giữ 5 tệp cũ gần nhất), đăng ký lại tác vụ và chạy API:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\DKAN-Zalo-API\Install-ApiStartup.ps1"
```

7. Kiểm tra `Get-Content -LiteralPath .\logs\api.log -Tail 20 -Encoding UTF8` có `DKAN_ZALO_API_READY`, rồi kiểm tra webhook vẫn chạy bằng lệnh ở mục 5 của [hướng dẫn webhook](ZALO_WEBHOOK_SETUP.md): phải trả HTTP 401 `invalid_signature`. Nếu trả 404, `server.cjs` vừa chép không phải bản của gói này; quay lại bản cũ như dưới đây.

`Start-Api.ps1` mới (chạy tay/dự phòng) chuyển hướng log qua `cmd.exe`: bản cũ chuyển hướng bằng PowerShell, và trên Windows PowerShell 5.1 dòng cảnh báo đầu tiên của node (`DKAN_ZALO_VERIFY_FAILED`, `DKAN_ZALO_MAIL_*`) làm script dừng, kéo theo API.

`/healthz` không kiểm tra thư. Sau lần thử gửi mã đầu tiên, xem `logs\api.log`; hai dòng chẩn đoán chỉ chứa tên biến hoặc mã cố định, không có giá trị khóa, địa chỉ hay mã xác minh:

- `DKAN_ZALO_MAIL_UNAVAILABLE {"missing":[…],"invalid":[…]}`: biến `MS_GRAPH_*` nào thiếu/sai. `MS_GRAPH_CLIENT_ID` phải là GUID, `MS_GRAPH_TENANT_ID` là GUID hoặc tên miền tenant, giá trị mẫu kiểu `your_…_here` bị coi là sai. Sửa `.env` rồi chạy lại `Install-ApiStartup.ps1`.
- `DKAN_ZALO_MAIL_FAILED {"code":…,"httpStatus":…}`: `token_failed` thường là sai tenant/client ID hoặc client secret sai/hết hạn; `send_failed` 403 thường là app thiếu `Mail.Send` hoặc hộp thư gửi ngoài phạm vi được phép, 404 là hộp thư gửi không tồn tại; `token_timeout`/`send_timeout` là VPS không ra được Microsoft.

Quay lại bản cũ: dừng API bằng `Install-ApiStartup.ps1 -Stop`, chép `server.before-otp.cjs` đè lên `server.cjs`, rồi chạy lại `Install-ApiStartup.ps1` (không kèm `-Stop`) để cấp lại quyền đọc và chạy API. Giữ `Install-ApiStartup.ps1` mới: nó chỉ thêm ghi log và chạy được với `server.cjs` cũ. Bốn dòng `MS_GRAPH_*` để nguyên không ảnh hưởng bản cũ.

### 4. Vercel: Redeploy

Đưa mã nguồn lên nhánh `main` của `tuan303/suatanapp` và **Redeploy** Production. Bản Vercel cũ chặn hai thao tác mới `mini.requestOtp`, `mini.verifyOtp` và không chuyển đúng các mã lỗi mới `otp_invalid`, `otp_expired`, `account_not_found`, `email_link_unavailable`, vì `api/zalo.ts` và adapter upstream chỉ cho qua danh sách cố định. Không cần thêm biến mới trên Vercel: Vercel chỉ chuyển tiếp, thư được gửi từ VPS.

### 5. Mini App: deploy LIVE-20261117.1

Build và deploy theo bước 3 của [hướng dẫn dữ liệu thật](ZALO_LIVE_DATA.md), kiểm tra dòng `Phiên bản: LIVE-20261117.1`, rồi chạy [danh sách kiểm thử trên thiết bị](ZALO_DEVICE_TEST.md) trước khi đưa bản Testing cho CBGV-NV.

### Vì sao được đặt emailVerified

Firebase không tự coi email Microsoft dùng tên miền riêng của trường là đã xác minh, trong khi mọi lần Mini App đọc hồ sơ đều kiểm tra lại `emailVerified`. Đường dẫn xác minh của chính Firebase chỉ chứng minh một điều: người dùng đọc được thư gửi tới hộp thư đó. Mã 6 số chứng minh đúng điều này, nên sau khi mã khớp, máy chủ đặt `emailVerified=true` bằng Admin SDK — tương đương việc người dùng bấm đường dẫn của Firebase.

Giới hạn đi kèm: mã chỉ gửi tới địa chỉ của chính tài khoản trường, tài khoản phải còn hoạt động, đúng tên miền và từng đăng nhập bằng Microsoft; máy chủ chỉ lưu bản băm HMAC của mã, không ghi mã vào log; mã hết hạn sau 10 phút, sai 5 lần là hủy, và mỗi tài khoản chỉ được nhập sai tổng cộng 10 lần trong 24 giờ dù từ bao nhiêu Zalo (sau đó mọi mã của tài khoản bị từ chối, chủ tài khoản liên kết qua website); gửi lại sau 60 giây, tối đa 5 thư/giờ và 10 thư/24 giờ cho mỗi Zalo và mỗi tài khoản. Cờ chỉ được đặt cho đúng UID đã nhận mã, sau khi mã khớp, và tài khoản được kiểm tra lại (còn hoạt động, đúng tên miền, đăng nhập Microsoft) ngay trước khi đặt. `firestore.rules` hiện không dựa vào `email_verified`, nên cờ này chỉ ảnh hưởng các bước liên kết Zalo (trang `/lien-ket-zalo` thôi yêu cầu thư xác minh cho tài khoản đó). Mỗi lần liên kết thành công, hộp thư còn nhận thư báo kèm cách hủy liên kết nếu không phải chủ tài khoản. Không sửa tay `emailVerified` hoặc cấp quyền quản trị để bỏ qua bước này.

Không gửi access token, mã xác minh, App Secret, client secret hoặc JSON Firebase qua chat/log. Hướng dẫn cập nhật các bản trước (`LIVE-20261103.1` nghiệp vụ thật, `LIVE-20261116.2` nút/QR trên website): [hướng dẫn dữ liệu thật](ZALO_LIVE_DATA.md).

Bản `LIVE-20261116.3` mở trang xác minh Microsoft bằng WebView của Zalo hoặc qua trình duyệt khi người dùng sao chép địa chỉ. Từ `LIVE-20261117.1`, nút mở trang và nút **Sao chép địa chỉ** nằm trong mục **Cách khác: liên kết qua website** của Mini App. [Kiểm thử trên thiết bị](ZALO_DEVICE_TEST.md)
