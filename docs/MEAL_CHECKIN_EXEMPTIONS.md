# Miễn chấm theo bữa trong Mini App Zalo

Tài liệu này chỉ nói về phần **máy chủ Mini App** (`miniapp/server`) và **Mini App** trong kho này. Trang quản trị danh sách miễn chấm, tab Đối soát, file xuất Excel và thư cảnh báo của Agent được quản lý ở bản DKAN, không nằm trong kho này.

## Dữ liệu

Firestore `meal_checkin_exemptions/{employeeId}`, do trang quản trị **Miễn chấm theo bữa** của website DKAN ghi:

```json
{ "employeeId": "100001", "email": "ten@hoangmaistarschool.edu.vn", "fullName": "...",
  "periods": [{ "from": "YYYY-MM-DD", "to": "YYYY-MM-DD hoặc null", "meals": ["breakfast", "lunch"] }] }
```

- Mã tài liệu phải trùng `employeeId` (đúng 6 chữ số), email viết thường, thuộc `@hoangmaistarschool.edu.vn`.
- Thiếu `meals` (dữ liệu bản đầu) = chỉ miễn bữa trưa. Thiếu `to` = chưa có ngày kết thúc; ngày kết thúc được tính hết ngày.
- Các khoảng của cùng một bữa không được chồng nhau. Quy tắc kiểm tra nằm ở `agent/lib/checkin-exemptions.mjs`, cùng quy tắc với Agent và website DKAN. Trang **Chấm ăn của tôi** (`/cham-an`) của website trong kho này chưa áp dụng miễn chấm: bữa được miễn vẫn hiện như chưa chấm ở đó.

## Máy chủ Mini App áp dụng thế nào

- Ảnh chụp dữ liệu (`meal.snapshot`) đọc thêm `meal_checkin_exemptions` **chỉ theo email đã xác minh** của tài khoản (truy vấn `email == <email>`, tối đa 21 tài liệu), trong cùng giao dịch với các dữ liệu cá nhân khác. Không đọc chính sách của người khác, không trả họ tên hay khoảng thời gian về Mini App.
- Chỉ miễn khi khớp **cả** mã nhân viên trên đơn tháng đó **và** email đã xác minh. Miễn chấm chỉ áp cho bữa **đã đăng ký mà chưa chấm**: bữa đó mang mã `exempt` ("Miễn chấm ăn"). Không tự đăng ký, không tạo lượt chấm giả; bữa đã chấm vẫn là "Đã chấm ăn", bữa không đăng ký vẫn là "Không đăng ký" hoặc "Có chấm, chưa đăng ký".
- Kiểm tra chặt **từng** tài liệu. Tài liệu hỏng (sai dạng, trùng mã, chồng thời gian, email/mã cần chuẩn hoá...) nêu mã trên đơn của Thầy/Cô, tài liệu hỏng không xác định được mã, hoặc quá 20 tài liệu cùng email: chưa biết Thầy/Cô có được miễn hay không. Khi đó các bữa đã đăng ký mà chưa chấm giữ mã `pending` và ngày đó mang `hold` = `Thông tin miễn chấm đang được kiểm tra` (`EXEMPTION_HOLD`); Mini App hiện ngày đó là **Cần đối chiếu dữ liệu** và bữa đó là **Chưa thể kết luận đối soát**. Không bao giờ báo lỗi cả ảnh chụp (503) vì dữ liệu miễn chấm; đăng ký, báo hủy, sự kiện và khảo sát vẫn hoạt động.
- Tài liệu hỏng của mã khác (cùng email) chỉ giữ mã đó; tháng đăng ký bằng mã hợp lệ vẫn được kết luận.

Quy tắc "đăng ký sau khi đã chấm" của bản DKAN (2026-11-09) **chưa** được đưa vào kho này: ăn trước rồi nộp đơn trong ngày vẫn tính là đã đăng ký và đã ăn như trước.

## Mini App

- Bản `LIVE-20261106.1` trở đi đọc được mã `exempt` và câu giải thích `EXEMPTION_HOLD`. Bản cũ `LIVE-20261103.1` từ chối cả ảnh chụp có bữa `exempt` (xem `miniapp/test/legacy-client-compat.test.mjs`), nên API mới chỉ được chạy khi mọi bản Mini App còn dùng (bản đang phát hành và bản Testing) từ `LIVE-20261106.1` trở lên. Bản đang phát hành (`LIVE-20261116.3`) đã đáp ứng, vì vậy thứ tự **VPS → Vercel → Mini App** của `LIVE-20261117.1` an toàn khi bản Testing cũng đáp ứng (kiểm tra ở mục Triển khai).
- Mục **Cá nhân → Lịch sử chấm ăn**: tháng đã bắt đầu mà Thầy/Cô không có đơn đăng ký (và tháng đó không có giờ chấm nào hiện ra) thì hiện thông báo "Thầy/Cô không đăng ký suất ăn tháng … nên Mini App không hiển thị lượt chấm của tháng này (nếu có)…" kèm hướng dẫn liên hệ Bộ phận Dinh dưỡng. Agent chỉ tách lượt chấm cho người có đơn của tháng đó.

## Triển khai

Miễn chấm đi cùng bản `LIVE-20261117.1`, theo thứ tự **VPS → Vercel → Mini App** ở mục *Cập nhật LIVE-20261117.1* của [hướng dẫn API Việt Nam](ZALO_VIETNAM_API.md).

**Trước khi thay `server.cjs`:** trên trang quản lý Mini App, xác nhận cả bản đang phát hành và bản Testing đều từ `LIVE-20261106.1` trở lên (mô tả phiên bản, hoặc dòng `Phiên bản:` khi mở bản đó). Nếu còn `LIVE-20261103.1` hoặc cũ hơn, chưa thay API cho tới khi đã đưa bản mới hơn lên kênh đó.

1. API: build lại `npm run build:zalo-api`, thay `server.cjs` trên VPS (`C:\DKAN-Zalo-API`) rồi chạy lại `Install-ApiStartup.ps1` (Run as administrator) để Local Service đọc được tệp mới và tác vụ `DKAN - Zalo API` chạy lại; sau đó deploy Vercel. Kho dữ liệu Firestore của API (`api/_lib/zalo-runtime.mjs`, `createFirestoreMealStore`) phải cho phép đọc `meal_checkin_exemptions` theo email đã xác minh cùng lúc với bản `miniapp/server` này; nếu không, mọi ảnh chụp dữ liệu sẽ lỗi. Hai phần này luôn nằm chung trong `server.cjs` của cùng một lần build.
2. Mini App: bản mới có thông báo tháng không đăng ký (bản đang chạy đã đọc được `exempt`).
3. Không cần biến môi trường mới. API đọc bằng Firebase Admin SDK nên không phụ thuộc Firestore Rules; truy vấn một trường bằng nhau (`email ==`) dùng chỉ mục đơn mặc định, không cần chỉ mục ghép.
4. Chưa có tài liệu miễn chấm nào thì Mini App hoạt động như trước.

## Kiểm thử

```powershell
node --test agent/test/checkin-exemptions.test.mjs agent/test/meal-rules.test.mjs tests/zalo-meal-runtime.test.mjs
Set-Location miniapp
node --test test/meal-history.test.mjs test/meal-business.test.mjs test/legacy-client-compat.test.mjs test/live-view.test.mjs test/business-client.test.mjs
```

Các bài kiểm thử dùng dữ liệu giả, không gọi Zalo, Firebase hay mạng.
