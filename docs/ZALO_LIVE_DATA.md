# Chuyển Mini App sang dữ liệu thật — LIVE-20261103.1

Mini App `3378419117469948059`, ứng dụng cha `928403133949225802`. Website/API công khai `https://suatanapp.vercel.app`; API Việt Nam `https://api-suatan.nshm.vn/api/zalo`; Firebase chung với website: `dkan-4b061`.

## Những chức năng đã nối

- Đọc hồ sơ từ tài khoản đã liên kết; phiên cá nhân giữ trong bộ nhớ, đóng hộp tài khoản không làm mất phiên. Đăng xuất, hết phiên hoặc hủy liên kết sẽ xóa dữ liệu cá nhân trong giao diện.
- Đăng ký bữa trưa hoặc sáng + trưa cho tháng hiện tại/tháng kế tiếp, theo cấu hình tháng đang mở, hạn và danh sách hạn chế của website. Tính số ngày như website; không ghi đè đơn đã có.
- Hủy ăn theo ngày và bữa đã đăng ký, từ ngày mai trước 16:00 giờ Việt Nam, hoặc ngày kia sau giờ chốt. Gia hạn lấy từ cấu hình hiện hành. API hỗ trợ lô tối đa 31 ngày; giao diện xác nhận từng ngày.
- Đăng ký có/không ăn sự kiện đang mở, kiểm tra lại hạn ở máy chủ; không ghi đè lựa chọn đã lưu.
- Đọc thực đơn đã import, xem tuần trước/sau và bảy nhóm món thực tế.
- Tra cứu chấm ăn tháng hiện tại và hai tháng trước, từ `meal_taps/{uid}/months/{month}`. Giữ trạng thái chờ, trùng mã, chốt an toàn, lượt chấm ngày nghỉ/sự kiện; không dùng dữ liệu toàn trường hoặc mã NV do người dùng nhập để lấy lượt chấm.
- Gửi/sửa đủ bộ câu hỏi khảo sát của Nhóm Dinh dưỡng trong khoảng mở/đóng thực tế, giữ thời điểm gửi lần đầu.

Mỗi thao tác ghi có màn xác nhận; chỉ thông báo thành công sau khi máy chủ đã lưu. Thử lại không tạo thêm đơn, và giao dịch kiểm tra cả hạn lẫn liên kết Zalo hiện hành. Không tự tạo dữ liệu mẫu hoặc gửi thao tác khi chỉ mở màn hình.

## Cập nhật đúng thứ tự

### 1. Đưa mã nguồn lên GitHub/Vercel

Dùng nhánh `main` của `tuan303/suatanapp`. Giữ nguyên các biến đã cấu hình và `DKAN_ZALO_API_UPSTREAM_URL=https://api-suatan.nshm.vn/api/zalo`. Bản Vercel mới bổ sung RPC nghiệp vụ; không cần tạo khóa mới hoặc thay Firebase.

### 2. Cập nhật API trên Windows Server 2022

Đường dẫn đang dùng: `C:\DKAN-Zalo-API`. Gói API mới vẫn dùng đúng các thư viện và cấu hình trước đây. Với máy đã cài bản API ngày 31/10 hoặc 03/11, chỉ cần thay **server.cjs**; giữ nguyên `.env`, thư viện và chứng chỉ/IIS.

1. Giải nén gói `DKAN-Zalo-API-Windows-LIVE-2026-11-03.zip` vào một thư mục tạm.
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

Trong Zalo Mini App Extension, mở đúng thư mục `miniapp`, kiểm tra ID, chọn **Deploy → Development hoặc Testing → Deploy**. Đóng bản cũ trên điện thoại, quét QR mới và kiểm tra dòng **LIVE-20261103.1**. Deploy Vercel không cập nhật bản đã tải lên Zalo.

### 4. Đối chiếu dữ liệu chính chủ

1. Kiểm tra tài khoản Zalo; không cần liên kết lại nếu liên kết cũ còn hiệu lực.
2. Đối chiếu họ tên, mã NV, đơn tháng, thực đơn và lịch sử với website. Tháng đã có đơn phải hiển thị đơn đã lưu, không mời tạo một đơn mới.
3. Chỉ gửi đăng ký/hủy/sự kiện khi đây là lựa chọn thật của chính người đang thử. Sau xác nhận, kiểm tra bản ghi tương ứng trên web. Không nhập đơn giả để thử trên dữ liệu đang vận hành.
4. Khảo sát chỉ gửi được trong giờ mở thật của tuần. Không tự mở khảo sát, đổi ngày nghỉ hoặc mở lại tháng để thử.
5. Đăng xuất hoặc hủy liên kết từ website: Mini App phải yêu cầu xác thực lại trước khi đọc/ghi tiếp.

## Giới hạn cần biết

Các thao tác mới ghi vào cùng dữ liệu nhà trường; **chưa gửi thêm email xác nhận từng lần đăng ký/hủy/sự kiện** như giao diện web. Lịch email khảo sát và cảnh báo quên chấm của DKAN Agent vẫn dùng dữ liệu chung và cấu hình hiện hành. Chưa thêm tin nhắn Zalo/OA.

Bản API cũ chỉ hỗ trợ liên kết sẽ từ chối RPC mới. Nếu Mini App báo máy chủ chưa hỗ trợ phiên bản, kiểm tra đã thay đúng `server.cjs` và khởi động lại tiến trình trên VPS. API không chạy thì Mini App báo lỗi, không thay bằng dữ liệu mẫu.

## Hợp đồng và quyền dữ liệu

RPC dùng `/api/zalo`: `meal.snapshot`, `meal.register`, `meal.cancel`, `meal.event`, `meal.survey`. Chỉ nhận các lựa chọn nghiệp vụ; không nhận UID/email/mã NV/quyền từ client. UID lấy từ phiên đã xác thực. Các ghi dùng Firestore transaction, đọc lại session, hai bản ghi liên kết và phiên bản trong chính giao dịch. Không cấp Firebase custom token, quyền quản trị hoặc quyền đọc lượt chấm toàn trường.

Giới hạn request 8 KiB, response 128 KiB; menu/đơn/lịch sử chỉ chuyển trường đã chọn. Giờ quản trị lưu dạng `datetime-local` được hiểu theo Việt Nam, không theo timezone VPS. Không cần sửa Firestore rules hoặc DKAN Agent để vận hành các RPC này.
