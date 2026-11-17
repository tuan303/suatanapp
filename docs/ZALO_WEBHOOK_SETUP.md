# Cấu hình webhook Zalo Mini App trên Windows Server 2022

Mini App `3378419117469948059`, Zalo App cha `928403133949225802`.
URL đăng ký với Zalo (chạy trên VPS Việt Nam, sau IIS):

```text
https://api-suatan.nshm.vn/api/zalo-webhook
```

Webhook nhận sự kiện `user.revoke.consent` có chữ ký `X-ZEvent-Signature`.
API kiểm tra chữ ký bằng **Open API Key**, thu hồi liên kết Zalo và dọn các bản ghi Zalo tạm tương ứng, kể cả mã xác minh email đang chờ. Dữ liệu nghiệp vụ nhà trường có cơ chế lưu trữ riêng. Bản cập nhật này không thực hiện xóa hồ sơ Microsoft hoặc chứng từ suất ăn dùng chung.

Không đăng ký `https://suatanapp.vercel.app/api/zalo-webhook` với Zalo. Vercel có cùng mã nhưng không giữ Open API Key nên chỉ trả `503 not_configured`; Vercel chỉ chuyển tiếp `/api/zalo` sang VPS.

## 0. VPS đang chạy

Webhook đã được cấu hình trên VPS từ 2026-11-05: `.env` trong `C:\DKAN-Zalo-API` có `DKAN_ZALO_ENABLED=true` và `ZALO_MINI_APP_API_KEY`, site IIS có rule `DKAN Zalo Webhook`, và Zalo đã lưu URL ở trên. API chạy nền bằng tác vụ `DKAN - Zalo API` do `Install-ApiStartup.ps1` tạo.

Khi cập nhật API, thay `server.cjs` và `Install-ApiStartup.ps1` theo mục 1, giữ các dòng hiện có của `.env`, `web.config` của IIS và cấu hình trên Zalo. Riêng gói `LIVE-20261117.1` còn cần thêm bốn dòng `MS_GRAPH_*` vào `.env` (thiếu chúng thì liên kết bằng mã email báo `email_link_unavailable`): với lần cập nhật này, làm theo mục *Cập nhật LIVE-20261117.1 → 3. VPS* trong [hướng dẫn API Việt Nam](ZALO_VIETNAM_API.md) (tệp `README.md` của gói) thay cho mục 1. Mục 2 đến 4 chỉ dùng cho máy chủ mới, khi IIS chưa có rule hoặc khi đổi Open API Key.

## 1. Cập nhật `server.cjs`

Tạo gói trên máy phát triển bằng `npm run build:zalo-api`. Thư mục `dist-zalo-api` có `server.cjs`, `web.config`, `Set-WebhookKey.ps1`, `Install-ApiStartup.ps1`, `.env.example` (giá trị trống) và `SHA256SUMS.txt` để đối chiếu.

Trên VPS, mở PowerShell bằng **Run as administrator** và sao lưu tệp hiện có

```powershell
Set-Location C:\DKAN-Zalo-API
Copy-Item -LiteralPath .\server.cjs -Destination .\server.before-update.cjs
```

Dùng File Explorer chép `server.cjs` và `Install-ApiStartup.ps1` mới vào `C:\DKAN-Zalo-API`. Giữ tệp `.env` thật hiện có để bảo toàn cấu hình đang dùng (bản `LIVE-20261117.1`: thêm bốn dòng `MS_GRAPH_*` trước khi chạy lại công cụ cài đặt, theo mục *Cập nhật LIVE-20261117.1 → 3. VPS* trong README của gói). Sau đó chạy lại công cụ cài đặt: công cụ dừng API đang chạy, cấp lại quyền đọc cho Local Service trên tệp vừa chép, đăng ký lại tác vụ, chạy lại API và kiểm tra `/healthz` (chi tiết ở mục *Tự chạy API sau khi Windows khởi động* trong README của gói)

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\DKAN-Zalo-API\Install-ApiStartup.ps1"
```

Phải thấy `API DANG CHAY NEN - healthz: ok`. Chỉ chạy một instance trên cổng `3031`; không chạy thêm `node .\server.cjs` bằng tay khi tác vụ đang chạy.

## 2. Cho IIS chuyển tiếp đường dẫn webhook

Mở **IIS Manager**, chọn site đang phục vụ `api-suatan.nshm.vn`, chọn **Basic Settings** và kiểm tra Physical path.
Site proxy đã thiết lập trong dự án dùng `C:\inetpub\DKAN-Zalo-Proxy`.

Trong đúng thư mục proxy của site API, sao lưu `web.config` hiện có. Với đường dẫn trên

```powershell
Copy-Item -LiteralPath C:\inetpub\DKAN-Zalo-Proxy\web.config -Destination C:\inetpub\DKAN-Zalo-Proxy\web.before-webhook.config
```

Gói có `web.config` tương ứng với site proxy riêng đã thiết lập. Nếu tệp hiện tại vẫn là mẫu proxy trước, dùng File Explorer chép tệp mới vào đúng thư mục proxy. Nếu tệp có thêm rule riêng, thêm duy nhất rule dưới đây **trước** rule `DKAN reject other paths`

```xml
<rule name="DKAN Zalo Webhook" stopProcessing="true">
  <match url="^api/zalo-webhook$" ignoreCase="false" />
  <action type="Rewrite" url="http://127.0.0.1:3031/api/zalo-webhook" appendQueryString="false" />
</rule>
```

Site cần sử dụng URL Rewrite và ARR đã cài từ lần thiết lập API. IIS tự nạp cấu hình khi lưu `web.config`. Nếu máy chủ dùng Caddy thay cho IIS, `Caddyfile` trong gói đã chuyển cả `/api/zalo` và `/api/zalo-webhook`.

## 3. Lấy Open API Key từ Zalo

1. Mở trang quản lý `https://mini.zalo.me/developers/` và chọn **Zalo App cha `928403133949225802`**.
2. Chọn **Open APIs**, mở **Quản lý APIs**.
3. Đặt Webhook URL thành `https://api-suatan.nshm.vn/api/zalo-webhook`.
4. Nếu tạo cấu hình lần đầu, trường **IP Access** là IP public đi ra của VPS. Đối chiếu IP với bảng điều khiển nhà cung cấp VPS. IP từng hiển thị trong phiên cấu hình là `103.57.220.97`, chỉ dùng nếu vẫn là IP đi ra hiện tại.
5. Bấm **Cập nhật** để lấy **API Key** theo hướng dẫn chính thức. Nếu đã có key, sử dụng key hiện hành của ứng dụng cha.
6. Lưu key trực tiếp vào VPS ở bước tiếp theo. Đây là key tại mục **Open APIs**, tách biệt với App Secret dùng đăng nhập.

Nếu giao diện yêu cầu URL trả lời thành công trước khi cấp key, giữ cửa sổ cấu hình và kiểm tra thông báo cụ thể. Bản API chặn xử lý khi thiếu key, không xác nhận đã xử lý thu hồi quyền khi chưa xác minh được chữ ký.

Tài liệu chính thức

- [Cấu hình Open API](https://docs.zaloplatforms.com/docs/MA/openApis/open/intergration-process)
- [Thiết lập webhook URL](https://docs.zaloplatforms.com/docs/MA/openApis/open/webhook/intergration-webhook)

## 4. Thêm key trên VPS và khởi động lại API

Gói có công cụ nhập khóa có che ký tự. Chép `Set-WebhookKey.ps1` vào `C:\DKAN-Zalo-API`, rồi chạy trong PowerShell bằng **Run as administrator** trên VPS

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\DKAN-Zalo-API\Set-WebhookKey.ps1"
```

Khi xuất hiện `Open API Key`, dán khóa thật rồi nhấn Enter. Công cụ sao lưu `.env` (tệp `.env.before-webhook-*.bak` cùng thư mục), lưu khóa và bật API trong tệp, bảo toàn các dòng cấu hình khác và quyền đọc của Local Service. Phải thấy `DA LUU CAU HINH WEBHOOK` trước khi khởi động lại API. Đây là thao tác ghi tệp, không tự dừng tiến trình API đang chạy.

API chỉ đọc `.env` khi Node khởi động, nên chạy lại công cụ cài đặt (cũng bằng **Run as administrator**) để dừng API cũ và chạy lại tác vụ

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\DKAN-Zalo-API\Install-ApiStartup.ps1"
```

Phải thấy `API DANG CHAY NEN - healthz: ok`.

Nếu muốn sửa bằng trình soạn thảo, mở `C:\DKAN-Zalo-API\.env` bằng Notepad và thêm một dòng

```dotenv
ZALO_MINI_APP_API_KEY="DAN_OPEN_API_KEY_THAT_VAO_DAY"
```

Thay toàn bộ phần giữa hai dấu nháy bằng API Key thật, lưu, rồi chạy lại công cụ cài đặt như trên. Key chỉ ở máy chủ. Không gửi key, `.env` hoặc ảnh đang hiển thị key qua chat. Gói cập nhật chứa `.env.example` với giá trị trống để đối chiếu tên biến.

## 5. Kiểm tra kết nối qua HTTPS

Giữ tiến trình API chạy, mở một cửa sổ PowerShell khác và chạy

```powershell
curl.exe -i --max-time 15 -X POST https://api-suatan.nshm.vn/api/zalo-webhook -H "Content-Type: application/json" --data-raw "{}"
```

Kết quả đúng cho lệnh thử này là **HTTP 401** với `invalid_signature`, vì lệnh kiểm tra chỉ gửi JSON trống, không có chữ ký của Zalo. Lệnh không hủy liên kết hoặc ghi dữ liệu.

- **404** thường là IIS chưa có rule webhook hoặc tiến trình vẫn chạy tệp API cũ.
- **503 `not_configured`** là key chưa được nạp. Kiểm tra tên biến, giá trị thật và chạy lại `Install-ApiStartup.ps1` sau khi lưu.
- **502 / 503 của IIS** là tiến trình Node chưa chạy hoặc IIS chưa kết nối được cổng `3031`.
- **401 `invalid_signature`** xác nhận đã tới handler với cấu hình key cơ bản. Xác minh chữ ký và xử lý dữ liệu thật cần sự kiện hợp lệ từ Zalo.

## 6. Điền mục trong hồ sơ xét duyệt

Trở lại **Bước 2 → Thiết lập Webhook URL → Thiết lập**, chọn đúng Zalo App cha và lưu URL ở đầu tài liệu.
Trên trang xét duyệt, kiểm tra mục Webhook đã được ghi nhận, rồi tiếp tục các mục Email và Điều khoản sử dụng.

Đối chiếu thực tế bằng một tài khoản kiểm thử được chủ tài khoản đồng ý. Sau khi người đó thu hồi quyền/xóa dữ liệu Mini App qua Zalo, Mini App phải yêu cầu liên kết/xác thực lại. Chỉ gửi thử nghiệm có chữ ký giả trên môi trường offline.

## Phạm vi xử lý đã triển khai

Chữ ký được tính theo SHA-256 trên giá trị các trường đã sắp xếp theo tên, cộng Open API Key, rồi so sánh constant-time. Chỉ sự kiện có chữ ký đúng và Mini App ID đúng mới được xử lý.

Liên kết và quyền dùng phiên được thu hồi trong giao dịch. Các session, claim và challenge gắn với Zalo đã thu hồi được dọn theo phạm vi sự kiện. Yêu cầu đang tạo hoặc xác nhận mã liên kết cũng kiểm tra mốc thu hồi trong giao dịch. Dấu nhận sự kiện (`zalo_webhook_events`) và mốc thu hồi (`zalo_link_revocations`) dùng khóa băm để chống xử lý lặp, không lưu UID hoặc Zalo ID thô trong các dấu này.

Liên kết bằng mã gửi tới email trường cũng theo mốc thu hồi. Tài liệu mã đang chờ của Zalo ID đó (`zalo_link_otps`, có địa chỉ email trường và UID) được xóa trong bước dọn, nếu mã được yêu cầu trước mốc thu hồi hoặc đã dùng xong. Mã yêu cầu trước mốc thu hồi không thể dùng để liên kết lại, kể cả khi bước dọn chưa chạy xong. Bộ đếm theo tài khoản trường (`zalo_link_otp_limits`, `zalo_link_rate_limits`) không chứa Zalo ID nên được giữ để tiếp tục giới hạn số thư và số lần nhập sai. Trước khi xóa tài liệu mã, bước dọn chỉ chép các thời điểm gửi mã trong 24 giờ gần nhất (tối đa 10, không kèm địa chỉ, UID hay mã) sang mốc thu hồi khóa băm, để việc thu hồi rồi cấp quyền lại không đặt lại giới hạn thư theo từng Zalo.

Thông báo lặp có thể thử lại bước dọn nếu lần trước bị gián đoạn. Sự kiện cũ không xóa liên kết mới hơn mốc thu hồi. API không ghi nội dung sự kiện, chữ ký, key hoặc danh sách nhân sự vào log. Các collection trên chỉ máy chủ đọc/ghi qua Firebase Admin SDK; không cần thêm quy tắc Firestore cho ứng dụng web.

Sự kiện thu hồi phải có `timestamp` hợp lệ như ví dụ của Zalo. Dù bảng mô tả của Zalo đánh dấu trường này không bắt buộc, máy chủ yêu cầu thời điểm để phân biệt sự kiện cũ với lần thu hồi mới sau khi liên kết lại. Sự kiện thu hồi thiếu thời điểm bị trả HTTP 400 và không được xác nhận đã xử lý. Những sự kiện khác có chữ ký đúng được xác nhận nhận thông báo và không sửa dữ liệu liên kết.

- [Sự kiện thu hồi](https://docs.zaloplatforms.com/docs/MA/openApis/open/webhook/eventRevokeAndRemoveUserData)
- [Xác minh chữ ký](https://docs.zaloplatforms.com/docs/MA/openApis/open/webhook/verifysignature)
