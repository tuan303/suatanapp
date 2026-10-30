# Thử liên kết tài khoản trên Zalo

Mini App ID: `3378419117469948059`. Zalo App ID cha: `928403133949225802`.
API và trang xác nhận liên kết: `https://suatanapp.vercel.app`.

## Trước khi chạy trên điện thoại

1. Dùng tài khoản Zalo có quyền Admin hoặc Developer của Mini App trên.
2. Mở `https://suatanapp.vercel.app/lien-ket-zalo` bằng Chrome/Edge, đăng nhập Microsoft của trường. Nếu bị chặn cửa sổ đăng nhập, cho phép popup của riêng trang này rồi thử lại. Nếu báo tên miền chưa được cấp phép, quản trị kiểm tra `suatanapp.vercel.app` tại Firebase Authentication → Settings → Authorized domains.
3. Trong thư mục `miniapp`, tạo `.env.local` có dòng công khai sau nếu chưa có:

```env
VITE_DKAN_API_ORIGIN=https://suatanapp.vercel.app
```

Không đặt App Secret hoặc JSON Firebase vào Mini App. Không cần cài lại thư viện khi đã cài đầy đủ; dừng dev/preview trước khi chạy `npm ci --ignore-scripts` nếu thực sự cần cài lại.

## Mở bằng Zalo Mini App Extension

1. Cài [Zalo Mini App Extension chính thức](https://marketplace.visualstudio.com/items?itemName=zalo-mini-app.zalo-mini-app) trong VS Code.
2. Dùng **Open Project**, chọn thư mục mã nguồn `miniapp` (trên máy đang phát triển: `C:\Users\Administrator\Downloads\DKAN\miniapp`).
3. Trong **Config**, chọn Mini App ID `3378419117469948059`.
4. Chọn **Login**, quét QR bằng tài khoản Zalo có quyền Admin/Developer để xác nhận quyền quản lý.
5. Có thể chọn **Run → Device** để thử trên điện thoại, hoặc mở phần deploy của Extension và chọn loại phiên bản **Testing**. Mô tả gợi ý: `Kiểm thử liên kết tài khoản Zalo; API suatanapp; dữ liệu nghiệp vụ minh họa`.
6. Sau khi deploy Testing thành công, dùng QR/deep link từ **Deploy Result** để mở đúng bản thử nghiệm trong ứng dụng Zalo. Trang localhost trên trình duyệt máy tính chỉ dùng để xem giao diện.

Việc tạo bản Testing và kiểm thử thiết bị là bước khác với deploy web/API trên Vercel. Chưa gửi xét duyệt hoặc Publish cho CBNV ở bước này.

## Kiểm tra một tài khoản

1. Trong Mini App, mở phần **Liên kết tài khoản** rồi bấm **Kiểm tra tài khoản Zalo**.
2. Nếu chưa liên kết, trên website `https://suatanapp.vercel.app/lien-ket-zalo`, chọn **Xác minh Microsoft và tạo mã**.
3. Sao chép mã một lần vào Mini App. Mã phân biệt chữ hoa/thường và có thời hạn ngắn (5 phút).
4. Quay lại website, đối chiếu yêu cầu và chủ động bấm xác nhận đúng tài khoản Zalo của mình.
5. Trở lại Mini App; chỉ khi API xác minh thành công mới xuất hiện hồ sơ CBNV thật trong hộp liên kết. Không gửi mã liên kết, token hoặc khóa qua chat.
6. Đóng/mở lại phần liên kết và kiểm tra đăng nhập bằng Zalo nhận đúng hồ sơ đã gắn. Có thể kiểm tra hủy liên kết trên web với tài khoản thử nghiệm được chủ tài khoản cho phép.

Các tab đăng ký, hủy ăn, thực đơn, sự kiện, lịch sử và khảo sát bên ngoài hộp liên kết vẫn là **dữ liệu minh họa**. Việc liên kết thành công chưa xác nhận các nghiệp vụ này đã đọc/ghi dữ liệu thật.

Tham khảo: [hướng dẫn Extension](https://marketplace.visualstudio.com/items?itemName=zalo-mini-app.zalo-mini-app), [quy trình Testing và phát hành](https://docs.zaloplatforms.com/docs/MA/intro/public-mini-program).
