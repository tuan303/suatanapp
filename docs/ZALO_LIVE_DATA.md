# Chuyển Mini App sang dữ liệu thật

Mini App `3378419117469948059`, ứng dụng cha `928403133949225802`. Website/API công khai `https://suatanapp.vercel.app`; API Việt Nam `https://api-suatan.nshm.vn/api/zalo`; Firebase chung với website: `dkan-4b061`.

**Bản mới nhất `LIVE-20261117.1`:** CBGV-NV liên kết ngay trong Mini App bằng email trường và mã 6 số gửi về hộp thư; tài khoản đã liên kết tự đăng nhập khi mở Mini App. Cùng bản này, API trên VPS áp dụng danh sách **Miễn chấm ăn theo bữa** (mục dưới) và mục Cá nhân giải thích vì sao tháng không đăng ký không có lượt chấm; gói API vẫn giữ webhook thu hồi quyền của Zalo ([hướng dẫn webhook](ZALO_WEBHOOK_SETUP.md)). Cập nhật đúng thứ tự **VPS (`server.cjs` + bốn biến `MS_GRAPH_*` trong `.env`, rồi chạy lại `Install-ApiStartup.ps1`) → Vercel (Redeploy) → Mini App**; chi tiết, quyền Entra `Mail.Send` và quyền cập nhật người dùng Firebase Auth ở mục *Cập nhật LIVE-20261117.1* trong [hướng dẫn API Việt Nam](ZALO_VIETNAM_API.md). Liên kết cũ vẫn hiệu lực, không ai phải liên kết lại. [Kiểm thử trên thiết bị](ZALO_DEVICE_TEST.md)

Bản `LIVE-20261103.1` đưa các màn hình nghiệp vụ sang dữ liệu thật. Bản `LIVE-20261106.1` bổ sung hiển thị **Miễn chấm ăn** và **Chưa xác định** trong kết quả chấm ăn.

Bản `LIVE-20261116.1` chỉ cần triển khai lại Mini App: lấy trạng thái hết hạn của yêu cầu liên kết từ máy chủ và cho phép kiểm tra lại tài khoản khi bước mở phiên gặp lỗi sau xác nhận.

Bản `LIVE-20261116.2` bỏ bước sao chép mã trong luồng website (nút **Mở trong Zalo** và QR). Từ `LIVE-20261117.1`, đường website/QR vẫn chạy nhưng chỉ là cách thay thế.

Bản `LIVE-20261116.3` sửa cách Mini App mở trang xác minh và cung cấp địa chỉ để mở bằng trình duyệt. Bản sửa này chỉ thay đổi Mini App. Từ `LIVE-20261117.1`, nút mở trang và địa chỉ này nằm trong mục **Cách khác: liên kết qua website** của Mini App.

## Những chức năng đã nối

- Đọc hồ sơ từ tài khoản đã liên kết; mở Mini App là tự đăng nhập (từ `LIVE-20261117.1`). Phiên cá nhân giữ trong bộ nhớ, đóng hộp tài khoản không làm mất phiên. Đăng xuất, hết phiên hoặc hủy liên kết sẽ xóa dữ liệu cá nhân trong giao diện.
- Đăng ký bữa trưa hoặc sáng + trưa cho tháng hiện tại/tháng kế tiếp, theo cấu hình tháng đang mở, hạn và danh sách hạn chế của website. Tính số ngày như website; không ghi đè đơn đã có.
- Hủy ăn theo ngày và bữa đã đăng ký, từ ngày mai trước 16:00 giờ Việt Nam, hoặc ngày kia sau giờ chốt. Gia hạn lấy từ cấu hình hiện hành. API hỗ trợ lô tối đa 31 ngày; giao diện xác nhận từng ngày.
- Đăng ký có/không ăn sự kiện đang mở, kiểm tra lại hạn ở máy chủ; không ghi đè lựa chọn đã lưu.
- Đọc thực đơn đã import, xem tuần trước/sau và bảy nhóm món thực tế.
- Tra cứu chấm ăn tháng hiện tại và hai tháng trước, từ `meal_taps/{uid}/months/{month}`. Giữ trạng thái chờ, trùng mã, chốt an toàn, lượt chấm ngày nghỉ/sự kiện; không dùng dữ liệu toàn trường hoặc mã NV do người dùng nhập để lấy lượt chấm.
- Tháng không đăng ký: agent chỉ tách lượt chấm cho người có đơn của tháng đó, nên Mini App không có lượt chấm để hiện. Màn hình ghi rõ điều này và mời liên hệ Bộ phận Dinh dưỡng nếu nhận email cảnh báo chấm ăn khi chưa đăng ký, giống trang "Chấm ăn của tôi" trên website (từ `LIVE-20261117.1`).
- Bữa đã đăng ký thuộc thời gian được miễn chấm hiện **Miễn chấm ăn**, cùng cách gọi với trang "Chấm ăn của tôi" trên website (cần API từ `LIVE-20261117.1`).
- Gửi/sửa đủ bộ câu hỏi khảo sát của Nhóm Dinh dưỡng trong khoảng mở/đóng thực tế, giữ thời điểm gửi lần đầu.

Mỗi thao tác ghi có màn xác nhận; chỉ thông báo thành công sau khi máy chủ đã lưu. Thử lại không tạo thêm đơn, và giao dịch kiểm tra cả hạn lẫn liên kết Zalo hiện hành. Không tự tạo dữ liệu mẫu hoặc gửi thao tác khi chỉ mở màn hình.

## Miễn chấm ăn theo bữa

- Quản trị thêm/xóa người được miễn trên website DKAN, theo từng bữa: mặc định miễn bữa trưa, bữa sáng vẫn phải chấm nếu không được miễn. Mini App chỉ đọc, không sửa danh sách. Khi danh sách còn trống, Mini App hiển thị như trước.
- Máy chủ chỉ đọc hồ sơ miễn chấm mang đúng email tài khoản trường đã xác minh, tối đa 20 hồ sơ; không tìm theo mã NV tự khai trong hồ sơ cá nhân. Một bữa chỉ được miễn khi mã NV trên đơn tháng và email đó cùng khớp danh sách.
- Mỗi hồ sơ được kiểm tra chặt như DKAN Agent. Hồ sơ hỏng có liên quan tới mã NV trên đơn tháng (hoặc quá 20 hồ sơ cùng một email) **không** làm Mini App báo lỗi. Cho tới khi quản trị sửa danh sách, ngày có bữa đã đăng ký mà chưa chấm hiện **Cần đối chiếu dữ liệu**, bữa đó hiện **Chưa thể kết luận đối soát** kèm dòng *Thông tin miễn chấm đang được kiểm tra*; bữa có lượt chấm vẫn hiện giờ chấm. Đăng ký, hủy, sự kiện, thực đơn và khảo sát vẫn dùng bình thường.
- Trạng thái bữa mà bản Mini App chưa biết hiện **Chưa xác định** thay vì làm hỏng cả màn hình dữ liệu.
- Email cảnh báo do DKAN Agent trên máy HAC gửi, không qua Mini App hay API trên VPS. Agent chỉ bỏ qua người được miễn khi chạy bản **2026-11-06.1** trở lên, cài từ bản DKAN (Agent trong kho này vẫn là bản 2026-10-09.1, chưa áp dụng miễn chấm). Khi agent còn bản cũ, người trong danh sách vẫn có thể nhận email cảnh báo thiếu chấm.
- Thứ tự triển khai: Mini App đang chạy (từ `LIVE-20261106.1`, hiện là `LIVE-20261116.3`) đã đọc được **Miễn chấm ăn**, nên thay API trên VPS trước theo thứ tự của `LIVE-20261117.1` là an toàn, với điều kiện bản Testing cũng từ `LIVE-20261106.1` trở lên (kiểm tra trên trang quản lý Mini App trước khi thay `server.cjs`). Chỉ bản cũ `LIVE-20261103.1` (và cũ hơn) từ chối ảnh chụp dữ liệu có bữa miễn chấm. Không cần sửa Firestore rules, tạo chỉ mục hay thêm biến môi trường. Chi tiết: [miễn chấm theo bữa trong Mini App](MEAL_CHECKIN_EXEMPTIONS.md).

## Cập nhật đúng thứ tự

Máy chủ cài mới hoàn toàn thì làm theo [cài API Việt Nam](ZALO_VIETNAM_API.md) trước, cấu hình bí mật trực tiếp trên máy chủ; không gửi `.env` hoặc khóa qua chat.

### 1. Cập nhật API trên Windows Server 2022

Đường dẫn đang dùng: `C:\DKAN-Zalo-API`. API chạy nền bằng tác vụ `DKAN - Zalo API` do `Install-ApiStartup.ps1` đăng ký (tài khoản Local Service, tự chạy khi Windows khởi động). Gói API mới vẫn dùng đúng các thư viện và cấu hình trước đây: thay **server.cjs** và `Install-ApiStartup.ps1` của gói, giữ nguyên `.env`, `node_modules`, chứng chỉ/IIS. Riêng `LIVE-20261117.1` thêm bốn dòng `MS_GRAPH_*` vào `.env` hiện có; không cần thư viện mới. Các bước đầy đủ (đối chiếu SHA256, kiểm tra log, kiểm tra webhook, quay lại bản cũ) ở mục *Cập nhật LIVE-20261117.1 → 3. VPS* trong [hướng dẫn API Việt Nam](ZALO_VIETNAM_API.md); tóm tắt:

1. Trên máy phát triển, tại thư mục gốc repository, chạy `npm run build:zalo-api` và chép thư mục `dist-zalo-api` lên VPS vào một thư mục tạm. Nếu chép qua nhiều bước, đối chiếu mã trong `SHA256SUMS.txt`.
2. Trên VPS mở PowerShell bằng **Run as administrator** và sao lưu tệp cũ. Không copy file cấu hình mẫu thành `.env`.

```powershell
Set-Location C:\DKAN-Zalo-API
Copy-Item -LiteralPath .\server.cjs -Destination .\server.before-update.cjs
```

3. Chép `Install-ApiStartup.ps1` mới của gói đè lên bản cũ, rồi dừng API và chờ dòng `API DA DUNG`. Không dừng bằng **End** trong Task Scheduler: có thể còn `node.exe` chạy bản cũ và giữ cổng 3031.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\DKAN-Zalo-API\Install-ApiStartup.ps1" -Stop
```

4. Chép `server.cjs` mới vào `C:\DKAN-Zalo-API` (với `LIVE-20261117.1`: thêm bốn dòng `MS_GRAPH_*` vào `.env` như hướng dẫn API).
5. Chạy lại lệnh cài đặt (không kèm `-Stop`). Lệnh cấp lại quyền đọc cho Local Service trên `server.cjs` vừa chép, đăng ký lại tác vụ, chạy API và kiểm tra `/healthz`; phải thấy `API DANG CHAY NEN - healthz: ok`.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\DKAN-Zalo-API\Install-ApiStartup.ps1"
```

`logs\api.log` phải có `DKAN_ZALO_API_READY`. Kiểm tra thêm:

```powershell
Invoke-RestMethod http://127.0.0.1:3031/healthz
curl.exe -i -X OPTIONS https://api-suatan.nshm.vn/api/zalo -H "Origin: https://h5.zdn.vn"
```

Kết quả mong đợi: `status: ok` và HTTP 204. Hai phép thử chỉ kiểm tra tiến trình/HTTPS; bước đối chiếu trong Mini App mới kiểm tra nghiệp vụ. Không dừng toàn bộ tiến trình Node hoặc website IIS khác. Chỉ chạy một instance trên cổng `3031`; không chạy thêm `node .\server.cjs` bằng tay khi tác vụ đang chạy.

Cần quay lại bản trước: dừng bằng `Install-ApiStartup.ps1 -Stop`, chép `server.before-update.cjs` đè lên `server.cjs`, rồi chạy lại `Install-ApiStartup.ps1` (không kèm `-Stop`) để cấp lại quyền đọc và chạy API. Mini App vẫn đọc được dữ liệu từ API cũ, chỉ không hiện **Miễn chấm ăn** (và bản `LIVE-20261117.1` không gửi được mã email).

API tự chạy lại sau khi đăng xuất/khởi động lại Windows nhờ tác vụ `DKAN - Zalo API`; chạy lại `Install-ApiStartup.ps1` sau mỗi lần thay `server.cjs` hoặc sửa `.env`.

### 2. Đưa mã nguồn lên GitHub/Vercel

Dùng nhánh `main` của `tuan303/suatanapp`. Giữ nguyên các biến đã cấu hình và `DKAN_ZALO_API_UPSTREAM_URL=https://api-suatan.nshm.vn/api/zalo`. Bản Vercel mới bổ sung RPC nghiệp vụ; không cần tạo khóa mới hoặc thay Firebase. Từ `LIVE-20261117.1`, Redeploy để Vercel cho qua `mini.requestOtp`, `mini.verifyOtp` và các mã lỗi mới; Vercel không cần thêm biến vì thư mã được gửi từ VPS. Vercel cũng có `/api/zalo-webhook` nhưng không giữ Open API Key nên chỉ trả `503 not_configured`; không đăng ký địa chỉ này với Zalo.

### 3. Deploy lại Mini App

Lấy mã nguồn `miniapp` mới từ GitHub hoặc gói Mini App đã chuẩn bị. Giữ lại cấu hình riêng hiện có; không copy `node_modules` giữa các máy. `VITE_DKAN_API_ORIGIN` vẫn là `https://suatanapp.vercel.app`.

```powershell
Set-Location C:\Users\Administrator\Downloads\DKAN\miniapp
npm run typecheck
npm run build
```

Nếu đây là thư mục mới/chưa cài thư viện, trước đó chạy `npm ci --ignore-scripts`; dừng dev/preview đang chạy để tránh khóa `esbuild.exe`.

Trong Zalo Mini App Extension, mở đúng thư mục `miniapp`, kiểm tra ID, chọn **Deploy → Development hoặc Testing → Deploy**. Đóng bản cũ trên điện thoại, quét QR mới và kiểm tra dòng phiên bản mới nhất (**LIVE-20261117.1**). Chỉ deploy Mini App sau khi VPS và Vercel đã cập nhật. Deploy Vercel không cập nhật bản đã tải lên Zalo.

### 4. Đối chiếu dữ liệu chính chủ

1. Mở Mini App: liên kết cũ còn hiệu lực thì tự đăng nhập, không cần liên kết lại. Zalo chưa liên kết thì liên kết bằng email trường và mã 6 số.
2. Đối chiếu họ tên, mã NV, đơn tháng, thực đơn và lịch sử với website. Tháng đã có đơn phải hiển thị đơn đã lưu, không mời tạo một đơn mới; tháng không đăng ký có dòng giải thích vì sao không có lượt chấm.
3. Với tài khoản có trong danh sách miễn chấm: bữa được miễn hiện **Miễn chấm ăn**, bữa không được miễn vẫn hiện trạng thái chấm như thường; kết quả phải khớp trang "Chấm ăn của tôi" trên website.
4. Chỉ gửi đăng ký/hủy/sự kiện khi đây là lựa chọn thật của chính người đang thử. Sau xác nhận, kiểm tra bản ghi tương ứng trên web. Không nhập đơn giả để thử trên dữ liệu đang vận hành.
5. Khảo sát chỉ gửi được trong giờ mở thật của tuần. Không tự mở khảo sát, đổi ngày nghỉ hoặc mở lại tháng để thử.
6. Hủy liên kết từ website: Mini App phải dừng đọc/ghi, mở lại thì về bước nhập email. **Đăng xuất phiên Mini App** chỉ xóa phiên hiện tại; mở lại vẫn tự đăng nhập vì liên kết còn.

## Giới hạn cần biết

Các thao tác mới ghi vào cùng dữ liệu nhà trường; **chưa gửi thêm email xác nhận từng lần đăng ký/hủy/sự kiện** như giao diện web (Mini App chỉ gửi thư mã xác minh và thư báo đã liên kết). Lịch email khảo sát và cảnh báo của DKAN Agent vẫn dùng dữ liệu chung và cấu hình hiện hành. Chưa thêm tin nhắn Zalo/OA.

Mini App chỉ thấy hồ sơ miễn chấm mang đúng email tài khoản; hồ sơ ghi email khác sẽ không được áp dụng. Quản trị sửa trên website, Mini App nhận thay đổi ở lần tải dữ liệu sau.

Bản API cũ chỉ hỗ trợ liên kết sẽ từ chối RPC mới. Nếu Mini App báo máy chủ chưa hỗ trợ phiên bản, kiểm tra đã thay đúng `server.cjs` và chạy lại `Install-ApiStartup.ps1` (Run as administrator) trên VPS. API không chạy thì Mini App báo lỗi, không thay bằng dữ liệu mẫu.

## Hợp đồng và quyền dữ liệu

RPC dùng `/api/zalo`: `meal.snapshot`, `meal.register`, `meal.cancel`, `meal.event`, `meal.survey`; liên kết bằng email dùng `mini.requestOtp` (nhận email) và `mini.verifyOtp` (nhận mã). Email ở đó chỉ là nơi gửi mã: quyền vào tài khoản chỉ có khi nhập đúng mã trong thư. RPC nghiệp vụ chỉ nhận các lựa chọn nghiệp vụ; không nhận UID/email/mã NV/quyền từ client. UID lấy từ phiên đã xác thực. Các ghi dùng Firestore transaction, đọc lại session, hai bản ghi liên kết, mốc thu hồi quyền Zalo và phiên bản trong chính giao dịch. Không cấp Firebase custom token, quyền quản trị hoặc quyền đọc lượt chấm toàn trường.

`meal.snapshot` đọc `meal_checkin_exemptions` bằng truy vấn theo email đã xác minh, tối đa 21 bản ghi (bản thứ 21 chỉ để nhận ra danh sách bị cắt). Phản hồi chỉ có trạng thái từng bữa; không trả họ tên, kỳ miễn hay lý do lỗi của hồ sơ. Bản này không đổi trường yêu cầu RPC và không thêm trường bắt buộc vào phản hồi. Ngày bị giữ vì hồ sơ miễn chấm lỗi có `hold` là câu `Thông tin miễn chấm đang được kiểm tra` (chữ tự do tối đa 80 ký tự, không phải mã mới): Mini App `LIVE-20261103.1` và các bản sau đều nhận, bản cũ hiện ngày đó là **Cần đối chiếu dữ liệu**. Dòng giải thích của tháng không đăng ký do Mini App tự hiện, không cần trường mới.

Webhook `/api/zalo-webhook` chỉ chạy trên VPS và chỉ nhận sự kiện `user.revoke.consent` có chữ ký `X-ZEvent-Signature` đúng: xóa liên kết của Zalo đó, dọn phiên, yêu cầu liên kết và mã email đang chờ, ghi mốc thu hồi để mã tạo trước mốc này không liên kết lại được. Xem [hướng dẫn webhook](ZALO_WEBHOOK_SETUP.md).

Giới hạn request 8 KiB, response 128 KiB; menu/đơn/lịch sử chỉ chuyển trường đã chọn. Giờ quản trị lưu dạng `datetime-local` được hiểu theo Việt Nam, không theo timezone VPS. Không cần sửa Firestore rules hoặc DKAN Agent để vận hành các RPC này.
