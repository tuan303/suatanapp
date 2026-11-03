# DKAN · Zalo Mini App

Mini App ID do chủ dự án cung cấp: **3378419117469948059**. Luôn xử lý ID dưới dạng chuỗi vì vượt giới hạn số nguyên an toàn của JavaScript. Tên làm việc: **Suất ăn Ngôi Sao Hoàng Mai**; chưa đối chiếu tên đăng ký trong Mini App Center.

Zalo App ID cha đã được chủ dự án đính chính và xác nhận: **928403133949225802**. Giá trị trước đó không còn được dùng trong cấu hình.

## Trạng thái hiện tại

Liên kết Microsoft/Zalo đã được kiểm tra thành công trên điện thoại. Bản `LIVE-20261103.1` chuyển các màn hình nghiệp vụ sang API dữ liệu thật, cùng Firebase `dkan-4b061` với website. Không hiển thị dữ liệu mẫu khi mất mạng hoặc API chưa cập nhật. Cần cập nhật cả API trên VPS và bản Mini App trong Zalo theo [hướng dẫn triển khai dữ liệu thật](../docs/ZALO_LIVE_DATA.md).

| Thành phần | Trạng thái |
| --- | --- |
| Bốn mục Trang chủ / Đăng ký / Thực đơn / Cá nhân | Đọc dữ liệu chính chủ từ API sau xác thực |
| Đăng ký, hủy, sự kiện, khảo sát | Có xác nhận và API ghi thật, kiểm tra thời hạn bằng giờ máy chủ |
| Xác minh access token Zalo phía server | Có hàm độc lập và kiểm thử giả lập |
| Liên kết Microsoft ↔ Zalo, phiên API cá nhân | Đã kiểm tra bằng tài khoản thật; phiên chỉ giữ trong bộ nhớ |
| API nghiệp vụ đọc/ghi đăng ký, thực đơn, lịch sử | Đã triển khai mã và kiểm thử giả lập; cần cập nhật VPS/Mini App và đối chiếu dữ liệu sau triển khai |
| Kiểm thử nghiệp vụ trên điện thoại | Thực hiện sau khi cập nhật hai thành phần |
| Phát hành Zalo cho toàn trường | Thực hiện sau kiểm thử và quy trình duyệt của Zalo |

Ứng dụng web DKAN, Agent HAC và cơ chế email hiện hành vẫn là hệ thống đang vận hành. Bộ khung này nằm trong thư mục riêng; không yêu cầu cập nhật Agent.

## Chạy giao diện trên máy tính

Chạy hằng ngày khi đã cài thư viện:

```powershell
cd C:\Users\Administrator\Downloads\DKAN\miniapp
npm run dev
```

Chỉ khi cài lần đầu hoặc cần cài lại thư viện: dừng các phiên `npm run dev` / `npm run preview` của Mini App bằng `Ctrl+C`, rồi chạy trong thư mục `miniapp`:

```powershell
npm ci --ignore-scripts
npm run dev
```

Trên Windows, cài lại khi Vite còn chạy có thể báo `EPERM` khi xóa `esbuild.exe`. `dev` và `preview` cùng dùng cổng 4930, vì vậy chỉ chạy một phiên tại một thời điểm.

Mở `http://127.0.0.1:4930`. Có thể dùng chế độ màn hình điện thoại của trình duyệt để xem giao diện. Đây chưa phải môi trường xác thực Zalo.

```powershell
npm run typecheck
npm test
npm run build
```

`npm run build` tạo gói `www/`, cấu hình danh sách tài nguyên trong `app-config.json` bằng plugin Zalo chính thức. `npm run preview` phục vụ bản build tại cổng 4930. Không đưa `node_modules/`, `www/` hoặc tệp `.env` thật vào Git.

## Mở trong công cụ Zalo

1. Dùng **Zalo Mini App Extension chính thức** trong VS Code, mở thư mục `miniapp`.
2. Trong Config, chọn Mini App ID **3378419117469948059** bằng tài khoản có quyền quản lý ứng dụng này. `project-info.json` là thông tin dự án, không thay thế bước liên kết trong công cụ Zalo.
3. Chạy thử trên thiết bị thật và kiểm tra vùng an toàn, bàn phím, điều hướng, hộp thoại. Bản mẫu vẫn chỉ dùng dữ liệu minh họa.
4. Chỉ đưa lên Testing khi chủ dự án đã chọn đúng ứng dụng đích. Chưa gửi xét duyệt hoặc Publish trong lần chuẩn bị này.

Hướng dẫn công cụ: [Zalo Mini App Extension chính thức](https://marketplace.visualstudio.com/items?itemName=zalo-mini-app.zalo-mini-app).

Các bước thao tác trên điện thoại, tạo bản Testing và xác nhận liên kết: [hướng dẫn thử nghiệm thiết bị](../docs/ZALO_DEVICE_TEST.md).

## Kiến trúc kết nối dữ liệu đề xuất

```text
Zalo Mini App → API cá nhân có xác thực → Firestore hiện có
                         ↑
          Liên kết Zalo ID ↔ Firebase UID của trường

Web quản trị → Firestore hiện có ← Agent HAC
```

Mini App dùng các API giới hạn theo chủ tài khoản. Backend tự xác định UID từ phiên đã xác minh, không nhận UID/email/mã nhân viên từ client làm bằng chứng quyền truy cập. Không phát token Firebase của UID quản trị cũ vào Mini App vì sẽ kế thừa quyền quản trị theo rules hiện tại.

Luồng liên kết đã có mã nguồn, kiểm thử giả lập và API máy chủ; **chưa kiểm thử trên điện thoại hoặc được Zalo xét duyệt**:

1. Người dùng đăng nhập Microsoft trên web trường; server xác minh Firebase ID token, tenant/email và trạng thái tài khoản.
2. Server phát mã ngẫu nhiên một lần, TTL ngắn, lưu bản băm kèm UID và mục đích liên kết. Không dùng email hoặc mã nhân viên làm mã liên kết.
3. Mini App gửi mã cùng Zalo access token về server. Server xác minh danh tính Zalo, tiêu thụ mã bằng transaction và lưu liên kết duy nhất.
4. Server cấp phiên API chỉ phạm vi cá nhân. Mọi thao tác kiểm tra owner, hạn phục vụ, hủy, khóa trùng và idempotency bằng giờ server.
5. Có luồng hủy liên kết/đổi Zalo được xác minh lại và thu hồi phiên; không tự chuyển quyền khi người khác nhập cùng tên/email.

`server/verify-zalo-identity.mjs` xác minh danh tính Zalo. `server/account-links.mjs` quản lý mã một lần, xác nhận web, phiên cá nhân 8 giờ và thu hồi liên kết. `api/zalo.ts` là RPC giới hạn thao tác; `api/_lib/zalo-runtime.mjs` xác minh Microsoft và kết nối Firebase Admin. Không import các module server vào mã client.

Trang web `/lien-ket-zalo` có nút xác minh Microsoft để tạo mã và nút xác nhận khi Mini App nhận mã; không tự liên kết chỉ nhờ nhập mã. Dashboard có lối mở trang này. Trạng thái liên kết thật chỉ xuất hiện khi server đã được cấu hình và endpoint đã được triển khai.

## Cấu hình để thử liên kết thật

Giữ `DKAN_ZALO_ENABLED=false` trong lúc chuẩn bị. Cấu hình các biến sau ở **server/Vercel**, không ở Mini App:

| Biến | Giá trị / mục đích |
| --- | --- |
| `ZALO_APP_ID` | `928403133949225802` |
| `ZALO_MINI_APP_ID` | `3378419117469948059` |
| `ZALO_APP_SECRET_KEY` | App Secret do Zalo cấp cho app cha nói trên; khác khóa email `MEAL_ALERT_SECRET` |
| `FIREBASE_ADMIN_CREDENTIALS_JSON` | JSON service account của project `dkan-4b061`, chỉ lưu ở server |
| `DKAN_ZALO_ENABLED` | `true` khi đã chuẩn bị tài khoản thử nghiệm và sẵn sàng kiểm tra |

Ở Mini App đặt `VITE_DKAN_API_ORIGIN=https://suatanapp.vercel.app` trong `.env.local`. Đây là địa chỉ API đã triển khai; trang tạo mã/xác nhận liên kết là `https://suatanapp.vercel.app/lien-ket-zalo`. Client chỉ chấp nhận hai origin HTTPS cố định `https://suatanapp.vercel.app` và `https://dkan.nshm.vn`; không chấp nhận URL preview, đường dẫn phụ, query hoặc thông tin đăng nhập trong URL. Những tên biến `VITE_*` đều có thể nằm trong bundle công khai, vì vậy không đặt khóa bí mật ở đây. Build lại sau khi thay env. Việc cấu hình biến trên Vercel cần đi kèm triển khai lại server.

Để thử đăng nhập Microsoft trên website mới, quản trị cần kiểm tra `suatanapp.vercel.app` trong Firebase Authentication → Settings → Authorized domains. Quyền trường, mã một lần, xác nhận trên web và thu hồi phiên vẫn được kiểm tra tại server.

Mặc định API trả 503 khi chưa bật/thiếu cấu hình. Các collections `zalo_link_*`, `zalo_links` chỉ được truy cập bằng server; rules hiện tại không cho client đọc/ghi chúng. Phiên Mini App không phải Firebase token và không kế thừa vai trò quản trị.

## Quy tắc hiện có cần giữ

- Dùng chung `agent/lib/meal-rules.mjs`, `survey.mjs`, `weekly-menu.mjs` và các quy tắc ngày/khung giờ của web.
- Giữ lựa chọn ăn sáng đồng thời đăng ký bữa trưa như luồng web hiện tại; không tự thay cách tính suất tháng khi chuyển nền tảng.
- Ngày nghỉ/ăn sự kiện vẫn tách khỏi suất tháng; dữ liệu thực tế được tra cứu theo nghiệp vụ tương ứng.
- Lượt chấm chưa đủ dữ liệu không bị kết luận là quên chấm. Khảo sát và sự kiện giữ đúng hạn, quyền và giới hạn hiện hành.
- Đăng ký/hủy phải kiểm tra quy tắc ở backend, không chỉ khóa nút trên UI.

## Các bước còn lại để vận hành

- Đã nhận hai ID; còn kiểm tra quyền tài khoản phát triển trong Mini App Center.
- Thiết lập App Secret của Zalo ở biến môi trường **server**; không gửi khóa qua chat hoặc đặt tên biến `VITE_*` cho khóa.
- API liên kết và phiên cá nhân đã hoạt động; triển khai API nghiệp vụ và Mini App theo `docs/ZALO_LIVE_DATA.md`, đối chiếu dữ liệu chính chủ trước khi phát hành.
- Kiểm thử Zalo trên thiết bị thật và thực hiện quy trình xác thực/xét duyệt của nền tảng trước khi phát hành.
- Giữ email; chỉ bổ sung thông báo Zalo sau khi xác nhận OA, quyền, mẫu tin, điều kiện gửi và chi phí phù hợp.

Tài liệu tham chiếu đã kiểm tra ngày 30/10/2026:

- [Chuyển Web App sang Mini App](https://docs.zaloplatforms.com/docs/MA/intro/getting-started/convert-web-app-to-mini-app): root DOM `app`, asset path tương đối; cơ chế lưu trữ và CORS cần thích ứng với Zalo.
- [Xác thực tài khoản Zalo phía server](https://docs.zaloplatforms.com/docs/MA/intro/best-practices/authen-user): xác minh access token bằng `appsecret_proof` với Zalo App cha.
- [Phát hành Mini App](https://docs.zaloplatforms.com/docs/MA/intro/public-mini-program): phiên bản Testing phải qua quy trình xác thực/xét duyệt trước Publish.
- [Journey Message](https://docs.zaloplatforms.com/docs/MA/journeyMessage/intro) và [ZBS](https://docs.zaloplatforms.com/docs/ZBS/bat-dau/gioi-thieu-zbs-template-message): điều kiện từng dịch vụ phải kiểm tra trước khi thay email bằng tin Zalo.

## Kiểm chứng

Kiểm thử tự động dùng dữ liệu và Zalo Graph giả lập; không gửi email, tạo đơn thử trên Firebase thật hoặc tự xác nhận liên kết. Luồng liên kết đã được chủ tài khoản kiểm tra trên thiết bị thật ngày 03/11/2026. Các nghiệp vụ mới cần đối chiếu lại sau khi triển khai.

Chạy `npm test`, `npm run typecheck`, `npm run build` trong thư mục `miniapp`. Kiểm thử bao phủ phiên, quyền chính chủ, cấu trúc snapshot, giao dịch ghi, hạn theo giờ Việt Nam và quy tắc chấm ăn dùng chung. Giao diện chỉ báo đã lưu sau phản hồi thành công, xóa dữ liệu khi hết phiên và không thay API lỗi bằng dữ liệu mẫu.
