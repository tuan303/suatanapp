# Chuyển Mini App sang dữ liệu thật — LIVE-20261103.1

**Bản mới nhất `LIVE-20261117.1`:** CBGV-NV liên kết ngay trong Mini App bằng email trường và mã 6 số gửi về hộp thư; tài khoản đã liên kết tự đăng nhập khi mở Mini App. Cập nhật đúng thứ tự **VPS (`server.cjs` + bốn biến `MS_GRAPH_*` trong `.env`) → Vercel (Redeploy) → Mini App**; chi tiết, quyền Entra `Mail.Send` và quyền cập nhật người dùng Firebase Auth ở mục *Cập nhật LIVE-20261117.1* trong [hướng dẫn API Việt Nam](ZALO_VIETNAM_API.md). Liên kết cũ vẫn hiệu lực, không ai phải liên kết lại. [Kiểm thử trên thiết bị](ZALO_DEVICE_TEST.md)

Bản `LIVE-20261116.2` bỏ bước sao chép mã trong luồng website (nút **Mở trong Zalo** và QR). Từ `LIVE-20261117.1`, đường website/QR vẫn chạy nhưng chỉ là cách thay thế.

Mini App `3378419117469948059`, ứng dụng cha `928403133949225802`. Website/API công khai `https://suatanapp.vercel.app`; API Việt Nam `https://api-suatan.nshm.vn/api/zalo`; Firebase chung với website: `dkan-4b061`.

## Những chức năng đã nối

- Đọc hồ sơ từ tài khoản đã liên kết; mở Mini App là tự đăng nhập (từ `LIVE-20261117.1`). Phiên cá nhân giữ trong bộ nhớ, đóng hộp tài khoản không làm mất phiên. Đăng xuất, hết phiên hoặc hủy liên kết sẽ xóa dữ liệu cá nhân trong giao diện.
- Đăng ký bữa trưa hoặc sáng + trưa cho tháng hiện tại/tháng kế tiếp, theo cấu hình tháng đang mở, hạn và danh sách hạn chế của website. Tính số ngày như website; không ghi đè đơn đã có.
- Hủy ăn theo ngày và bữa đã đăng ký, từ ngày mai trước 16:00 giờ Việt Nam, hoặc ngày kia sau giờ chốt. Gia hạn lấy từ cấu hình hiện hành. API hỗ trợ lô tối đa 31 ngày; giao diện xác nhận từng ngày.
- Đăng ký có/không ăn sự kiện đang mở, kiểm tra lại hạn ở máy chủ; không ghi đè lựa chọn đã lưu.
- Đọc thực đơn đã import, xem tuần trước/sau và bảy nhóm món thực tế.
- Tra cứu chấm ăn tháng hiện tại và hai tháng trước, từ `meal_taps/{uid}/months/{month}`. Giữ trạng thái chờ, trùng mã, chốt an toàn, lượt chấm ngày nghỉ/sự kiện; không dùng dữ liệu toàn trường hoặc mã NV do người dùng nhập để lấy lượt chấm.
- Gửi/sửa đủ bộ câu hỏi khảo sát của Nhóm Dinh dưỡng trong khoảng mở/đóng thực tế, giữ thời điểm gửi lần đầu.

Mỗi thao tác ghi có màn xác nhận; chỉ thông báo thành công sau khi máy chủ đã lưu. Thử lại không tạo thêm đơn, và giao dịch kiểm tra cả hạn lẫn liên kết Zalo hiện hành. Không tự tạo dữ liệu mẫu hoặc gửi thao tác khi chỉ mở màn hình.

## Cập nhật đúng thứ tự

### 1. Đưa mã nguồn lên GitHub/Vercel

Dùng nhánh `main` của `tuan303/suatanapp`. Giữ nguyên các biến đã cấu hình và `DKAN_ZALO_API_UPSTREAM_URL=https://api-suatan.nshm.vn/api/zalo`. Bản Vercel mới bổ sung RPC nghiệp vụ; không cần tạo khóa mới hoặc thay Firebase. Từ `LIVE-20261117.1`, Redeploy để Vercel cho qua `mini.requestOtp`, `mini.verifyOtp` và các mã lỗi mới; Vercel không cần thêm biến vì thư mã được gửi từ VPS.

### 2. Cập nhật API trên Windows Server 2022

Đường dẫn đang dùng: `C:\DKAN-Zalo-API`. Gói API mới vẫn dùng đúng các thư viện và cấu hình trước đây. Với máy đã cài bản API ngày 31/10 hoặc 03/11, chỉ cần thay **server.cjs**; giữ nguyên `.env`, thư viện và chứng chỉ/IIS. Riêng `LIVE-20261117.1` thêm bốn dòng `MS_GRAPH_*` vào `.env` hiện có (xem [hướng dẫn API Việt Nam](ZALO_VIETNAM_API.md)); không cần thư viện mới.

1. Giải nén gói API mới nhất (tạo bằng `npm run build:zalo-api`, thư mục `dist-zalo-api`) vào một thư mục tạm.
2. Tại cửa sổ đang chạy `node .\server.cjs` trên VPS, nhấn **Ctrl+C**. Nếu đang chạy bằng Scheduled Task, dừng riêng task API trước khi cập nhật.
3. Sao lưu tệp cũ rồi chép đè tệp mới bằng Explorer hoặc PowerShell. Không copy file cấu hình mẫu thành `.env`.

```powershell
Set-Location C:\DKAN-Zalo-API
Copy-Item -LiteralPath .\server.cjs -Destination .\server.before-live.cjs
```

Chép `server.cjs` vừa giải nén vào `C:\DKAN-Zalo-API`, sau đó chạy:

```powershell
Set-Location C:\DKAN-Zalo-API
node .\server.cjs
```

Phải hiện `DKAN_ZALO_API_READY`. Giữ cửa sổ đang chạy; mở PowerShell khác để kiểm tra:

```powershell
Invoke-RestMethod http://127.0.0.1:3031/healthz
curl.exe -i -X OPTIONS https://api-suatan.nshm.vn/api/zalo -H "Origin: https://h5.zdn.vn"
```

Kết quả mong đợi: `status: ok` và HTTP 204. Hai phép thử chỉ kiểm tra tiến trình/HTTPS; bước đối chiếu trong Mini App mới kiểm tra nghiệp vụ. Không dừng toàn bộ tiến trình Node hoặc website IIS khác.

Nếu máy mới hoàn toàn, dùng toàn bộ gói API và quy trình [cài API Việt Nam](ZALO_VIETNAM_API.md), cấu hình bí mật trực tiếp trên máy chủ; không gửi `.env` hoặc khóa qua chat. Để chạy sau khi đăng xuất/khởi động lại, dùng task `DKAN - Zalo API` với `Start-Api.ps1` như hướng dẫn API, chỉ chạy một instance.

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
2. Đối chiếu họ tên, mã NV, đơn tháng, thực đơn và lịch sử với website. Tháng đã có đơn phải hiển thị đơn đã lưu, không mời tạo một đơn mới.
3. Chỉ gửi đăng ký/hủy/sự kiện khi đây là lựa chọn thật của chính người đang thử. Sau xác nhận, kiểm tra bản ghi tương ứng trên web. Không nhập đơn giả để thử trên dữ liệu đang vận hành.
4. Khảo sát chỉ gửi được trong giờ mở thật của tuần. Không tự mở khảo sát, đổi ngày nghỉ hoặc mở lại tháng để thử.
5. Hủy liên kết từ website: Mini App phải dừng đọc/ghi, mở lại thì về bước nhập email. **Đăng xuất phiên Mini App** chỉ xóa phiên hiện tại; mở lại vẫn tự đăng nhập vì liên kết còn.

## Giới hạn cần biết

Các thao tác mới ghi vào cùng dữ liệu nhà trường; **chưa gửi thêm email xác nhận từng lần đăng ký/hủy/sự kiện** như giao diện web (Mini App chỉ gửi thư mã xác minh và thư báo đã liên kết). Lịch email khảo sát và cảnh báo quên chấm của DKAN Agent vẫn dùng dữ liệu chung và cấu hình hiện hành. Chưa thêm tin nhắn Zalo/OA.

Bản API cũ chỉ hỗ trợ liên kết sẽ từ chối RPC mới. Nếu Mini App báo máy chủ chưa hỗ trợ phiên bản, kiểm tra đã thay đúng `server.cjs` và khởi động lại tiến trình trên VPS. API không chạy thì Mini App báo lỗi, không thay bằng dữ liệu mẫu.

## Hợp đồng và quyền dữ liệu

RPC dùng `/api/zalo`: `meal.snapshot`, `meal.register`, `meal.cancel`, `meal.event`, `meal.survey`; liên kết bằng email dùng `mini.requestOtp` (nhận email) và `mini.verifyOtp` (nhận mã). Email ở đó chỉ là nơi gửi mã: quyền vào tài khoản chỉ có khi nhập đúng mã trong thư. RPC nghiệp vụ chỉ nhận các lựa chọn nghiệp vụ; không nhận UID/email/mã NV/quyền từ client. UID lấy từ phiên đã xác thực. Các ghi dùng Firestore transaction, đọc lại session, hai bản ghi liên kết và phiên bản trong chính giao dịch. Không cấp Firebase custom token, quyền quản trị hoặc quyền đọc lượt chấm toàn trường.

Giới hạn request 8 KiB, response 128 KiB; menu/đơn/lịch sử chỉ chuyển trường đã chọn. Giờ quản trị lưu dạng `datetime-local` được hiểu theo Việt Nam, không theo timezone VPS. Không cần sửa Firestore rules hoặc DKAN Agent để vận hành các RPC này.

Bản `LIVE-20261116.3` sửa cách Mini App mở trang xác minh và cung cấp địa chỉ để mở bằng trình duyệt. Bản sửa này chỉ thay đổi Mini App. Từ `LIVE-20261117.1`, nút mở trang và địa chỉ này nằm trong mục **Cách khác: liên kết qua website** của Mini App.
