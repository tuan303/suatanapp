# Thử liên kết tài khoản trên Zalo

Mini App ID: `3378419117469948059`. Zalo App ID cha: `928403133949225802`.
API công khai: `https://suatanapp.vercel.app/api/zalo`, chuyển tiếp tới máy chủ Việt Nam `api-suatan.nshm.vn`. Bản cần kiểm tra: **LIVE-20261117.1**.

## CBGV-NV liên kết thế nào

Từ `LIVE-20261117.1`, lần liên kết đầu tiên diễn ra hoàn toàn trong Mini App: không mở website, không có cửa sổ đăng nhập Microsoft, không có bước "xác minh email" riêng.

1. Mở Mini App. Nếu Zalo này chưa liên kết, hộp **Liên kết tài khoản** tự mở ở bước nhập email.
2. Nhập phần trước `@hoangmaistarschool.edu.vn` (gõ cả địa chỉ cũng được), bấm **Gửi mã xác minh**.
3. Mở hộp thư trường, tìm thư **Mã xác minh liên kết Zalo: ……** (xem cả Thư rác). Nhập 6 số; đủ 6 số Mini App tự gửi.
4. Xong: hồ sơ và dữ liệu suất ăn hiện ngay. Hộp thư nhận thêm thư **Tài khoản Suất ăn vừa liên kết với Zalo**.
5. Các lần mở sau, Mini App **tự đăng nhập** bằng Zalo đã liên kết, không cần bấm gì.

Mã có hiệu lực 10 phút và chỉ được nhập sai 5 lần. **Gửi lại mã** mở sau 60 giây, kể cả sau khi bấm **Đổi email** (nút gửi đếm ngược); tối đa 5 thư mỗi giờ và 10 thư mỗi 24 giờ cho một Zalo và cho một tài khoản. Bấm gửi lại đúng email đó trong 60 giây (ví dụ mạng chậm làm mất kết quả) không gửi thư mới mà mở bước nhập mã của thư vừa gửi. Mã mới thay mã cũ. Màn hình chỉ hiện email đã che, ví dụ `t***m@hoangmaistarschool.edu.vn`.

Một tài khoản bị nhập sai tổng cộng 10 lần trong 24 giờ, từ bất kỳ Zalo nào, thì mọi mã của tài khoản đó bị từ chối và Mini App không gửi thêm mã cho tới khi đủ 24 giờ. Giới hạn gửi theo tài khoản cũng áp dụng cho người khác nhập email của Thầy/Cô. Khi bị chặn như vậy, chủ tài khoản vẫn liên kết được qua website (mục **Cách khác: liên kết qua website**, Mini App tự mở ra khi báo lỗi); đường website không bị các giới hạn này.

- **Điều kiện:** CBGV-NV đã đăng nhập website suất ăn (`https://dkan.nshm.vn`) bằng tài khoản Microsoft của trường ít nhất một lần — lần đó tạo tài khoản Suất ăn. Chưa từng đăng nhập thì Mini App báo chưa có tài khoản và không gửi thư.
- **Một tài khoản trường gắn một Zalo.** Liên kết từ Zalo mới sẽ thay Zalo cũ (Mini App báo trước ở bước nhập mã); phiên của Zalo cũ hết hiệu lực ngay.
- **Một Zalo đã gắn tài khoản thì luôn tự đăng nhập vào tài khoản đó.** Muốn chuyển Zalo này sang tài khoản khác, hủy liên kết trên website `/lien-ket-zalo` trước.

Máy chủ đặt `emailVerified=true` cho tài khoản sau khi mã đúng; lý do và giới hạn xem mục *Vì sao được đặt emailVerified* trong [hướng dẫn API Việt Nam](ZALO_VIETNAM_API.md). Không sửa tay cờ này trong Firebase Console.

## Trước khi chạy trên điện thoại

1. VPS đã chạy `server.cjs` mới và có đủ `MS_GRAPH_*`, Vercel đã Redeploy — theo mục *Cập nhật LIVE-20261117.1* trong [hướng dẫn API Việt Nam](ZALO_VIETNAM_API.md). Thiếu VPS hoặc Vercel thì Mini App mới báo lỗi máy chủ ngay ở bước gửi mã.
2. Dùng tài khoản Zalo có quyền Admin/Developer của Mini App (hoặc được thêm vào bản Testing). Thử thay Zalo cũ cần hai tài khoản Zalo như vậy.
3. Dùng tài khoản trường thử nghiệm mà chủ tài khoản đồng ý cho thử, đã từng đăng nhập website và đọc được hộp thư. Để thử `account_not_found`, cần một địa chỉ trường chưa từng đăng nhập website — trường hợp này không gửi thư nào.
4. Trong thư mục `miniapp`, `.env.local` có dòng công khai sau:

```env
VITE_DKAN_API_ORIGIN=https://suatanapp.vercel.app
```

Không đặt App Secret, JSON Firebase hoặc `MS_GRAPH_*` vào Mini App. Không cần cài lại thư viện khi đã cài đầy đủ; dừng dev/preview trước khi chạy `npm ci --ignore-scripts` nếu thực sự cần cài lại.

## Mở bằng Zalo Mini App Extension

1. Cài [Zalo Mini App Extension chính thức](https://marketplace.visualstudio.com/items?itemName=zalo-mini-app.zalo-mini-app) trong VS Code.
2. Dùng **Open Project**, chọn thư mục mã nguồn `miniapp` (trên máy đang phát triển: `C:\Users\Administrator\Downloads\DKAN\miniapp`).
3. Trong **Config**, chọn Mini App ID `3378419117469948059`.
4. Chọn **Login**, quét QR bằng tài khoản Zalo có quyền Admin/Developer để xác nhận quyền quản lý.
5. Chọn **Run → Device** để thử trên điện thoại, hoặc **Deploy → Development/Testing → Deploy**. Mô tả gợi ý cho Testing: `LIVE-20261117.1: liên kết bằng mã gửi email trường, tự đăng nhập`.
6. Đóng Mini App cũ trên điện thoại, mở bằng QR/deep link trong **Deploy Result**. Kiểm tra dòng `Phiên bản: LIVE-20261117.1` (hộp Liên kết tài khoản hoặc chân trang). Trang localhost trên máy tính chỉ dùng để xem giao diện; deploy Vercel không cập nhật bản đã tải lên Zalo.

Tạo bản Testing và kiểm thử thiết bị là bước khác với deploy web/API. Chưa gửi xét duyệt hoặc Publish cho CBNV ở bước này.

## Danh sách kiểm thử

Thử trên cả Android và iOS. Chỉ dùng tài khoản đã được đồng ý; không gửi mã xác minh qua chat, kể cả khi báo lỗi.

| # | Trường hợp | Thao tác | Kết quả mong đợi |
| --- | --- | --- | --- |
| 1 | Liên kết lần đầu | Zalo chưa liên kết, mở Mini App, nhập email, nhập mã trong thư | Hộp liên kết tự mở ở bước email; sau 6 số tự gửi, hồ sơ đúng người hiện ra; hộp thư nhận thư báo đã liên kết |
| 2 | Tự đăng nhập | Đóng hẳn Mini App rồi mở lại | Dữ liệu cá nhân tự tải, không phải bấm **Kiểm tra tài khoản Zalo** hay nhập lại mã |
| 3 | Đăng xuất phiên | Bấm **Đăng xuất phiên Mini App**, đóng rồi mở lại | Dữ liệu cá nhân biến mất ngay; mở lại tự đăng nhập vì liên kết vẫn còn |
| 4 | Mất mạng khi mở | Tắt mạng, mở Mini App; bật lại mạng, thử lại | Giữ màn hình chính, không hiện lỗi gây hoang mang; có mạng thì thử lại được |
| 5 | Sai mã | Nhập một mã 6 số khác mã trong thư | "Mã xác minh chưa đúng…"; vẫn ở bước nhập mã |
| 6 | Sai quá 5 lần | Tiếp tục nhập sai tới lần thứ 5, rồi nhập mã đúng | Báo mã hết hạn hoặc nhập sai quá nhiều lần; mã đúng cũng không dùng được, phải gửi mã mới |
| 7 | Gửi lại mã | Ngay sau khi gửi, xem nút **Gửi lại mã**; chờ hết đếm ngược rồi bấm; nhập mã của thư cũ | Nút mờ và đếm ngược 60 giây; thư mới tới; mã cũ bị từ chối (tính một lần nhập sai), mã mới dùng được |
| 8 | Quá số lần gửi | Gửi tổng cộng 6 lần trong 1 giờ, mỗi lần cách nhau hơn 1 phút (cùng Zalo hoặc cùng tài khoản) | Lần thứ 6 báo tạm thời chưa gửi được mã, gợi ý đợi hoặc liên kết qua website (mục **Cách khác** tự mở); không có thư mới |
| 9 | Mã hết hạn | Chờ quá 10 phút rồi nhập mã | Báo mã đã hết hạn, gợi ý gửi mã mới |
| 10 | Đổi email | Ở bước nhập mã bấm **Đổi email**; nhập sai tên miền/định dạng; rồi nhập đúng một email khác trước khi đủ 60 giây kể từ lần gửi trước | Quay lại bước email; địa chỉ sai báo ngay, không gửi yêu cầu; nút gửi hiện **Gửi mã sau … giây** và đếm ngược, hết giờ thì gửi được và thư tới đúng email mới |
| 11 | Thay Zalo cũ | Tài khoản A đã gắn Zalo X. Trên Zalo Y nhập email A, nhập mã | Trước khi nhập mã có ghi chú sẽ thay Zalo đang liên kết; Y đăng nhập vào A; thư báo tới hộp thư A; trên X, thao tác kế tiếp yêu cầu đăng nhập lại và mở lại Mini App về bước email |
| 12 | Zalo đã gắn tài khoản khác | Zalo Y đã gắn B, mở Mini App | Tự đăng nhập B, không có bước email; muốn đổi sang A thì hủy liên kết trên website trước |
| 13 | Chưa có tài khoản | Nhập email trường của người chưa từng đăng nhập website | "Chưa có tài khoản Suất ăn cho email này…", không có thư; sau khi người đó đăng nhập `https://dkan.nshm.vn` một lần bằng Microsoft thì thử lại được |
| 14 | Hủy liên kết trên website | Hủy liên kết tại `/lien-ket-zalo`, rồi mở lại Mini App | Mini App không đọc/ghi tiếp được; mở lại về bước nhập email |
| 15 | Đường website/QR | Làm theo mục *Liên kết qua website* bên dưới | Vẫn liên kết được như bản `LIVE-20261116.2` |
| 16 | Mất kết quả khi gửi mã | Bấm **Gửi mã xác minh** rồi tắt mạng ngay; bật lại mạng, bấm gửi lại trong 1 phút | Mở bước nhập mã, không có thư thứ hai; mã trong thư đầu tiên dùng được |
| 17 | Dán mã | Ở bước nhập mã gõ trước vài số, rồi dán `123 456` hoặc cả dòng tiêu đề thư | Ô mã thay bằng đúng 6 số vừa dán (không ghép với số đã gõ) và tự xác minh |

### Lỗi phía máy chủ khi gửi/nhập mã

Quản trị đối chiếu dòng `DKAN_ZALO_MAIL_UNAVAILABLE` / `DKAN_ZALO_MAIL_FAILED` trong `logs\api.log` trên VPS theo [hướng dẫn API Việt Nam](ZALO_VIETNAM_API.md).

- **"Liên kết bằng email chưa được bật trên máy chủ"** (`email_link_unavailable`): VPS thiếu một trong bốn biến `MS_GRAPH_*`, hoặc `MS_GRAPH_SENDER` không phải địa chỉ `@hoangmaistarschool.edu.vn`. Đăng nhập Zalo đã liên kết và các nghiệp vụ khác vẫn chạy.
- **Lỗi máy chủ ngay khi bấm Gửi mã xác minh** (`service_unavailable`): Microsoft từ chối gửi thư — client secret hết hạn/sai, app thiếu quyền `Mail.Send`, hoặc hộp thư gửi nằm ngoài phạm vi app được phép gửi. Mã vừa tạo bị hủy; sửa xong, chờ hết 60 giây rồi gửi lại (lần lỗi vẫn tính vào giới hạn gửi của Zalo và của tài khoản).
- **Lỗi máy chủ sau khi nhập đúng mã** (`service_unavailable`): thường do service account Firebase chưa được cập nhật người dùng Auth. Sửa quyền rồi nhập **lại đúng mã đó** trong 10 phút là xong, không cần gửi mã mới.
- **Mạng chậm hoặc quá thời gian chờ sau khi nhập mã:** máy chủ có thể đã liên kết xong nhưng câu trả lời bị mất. Mini App tự hỏi lại một lần bằng Zalo và đăng nhập luôn nếu đã liên kết; chỉ khi chưa liên kết mới hiện lỗi. Thư báo đã liên kết có thể tới chậm hơn một chút.
- **Báo tài khoản nhà trường chưa thể sử dụng** (`account_unavailable`): tài khoản bị khóa, không thuộc tên miền trường hoặc chưa từng đăng nhập bằng Microsoft. Quản trị kiểm tra trong Firebase Authentication; không cấp quyền quản trị để bỏ qua.

## Liên kết qua website (cách thay thế)

Đường cũ vẫn hoạt động, nhưng Mini App không tự giới thiệu nữa; chỉ hiện **Tiếp tục liên kết** khi được mở từ nút/QR của website (tham số `dkanLink`).

1. Trên máy tính hoặc điện thoại, mở `https://suatanapp.vercel.app/lien-ket-zalo` bằng Chrome/Edge, đăng nhập Microsoft của trường. Bị chặn cửa sổ đăng nhập thì cho phép popup của riêng trang này. Báo tên miền chưa được cấp phép thì quản trị kiểm tra `suatanapp.vercel.app` tại Firebase Authentication → Settings → Authorized domains.
2. Nếu trang yêu cầu xác minh email: bấm **Gửi thư xác minh email**, mở đường dẫn trong hộp thư trường, quay lại bấm **Tôi đã xác minh — kiểm tra lại**. Tài khoản đã nhập đúng mã email trong Mini App thì email đã được xác minh; nếu trang vẫn hỏi (phiên web cũ), chỉ cần bấm **Tôi đã xác minh — kiểm tra lại**.
3. Chọn **Bắt đầu liên kết**, rồi **Mở trong Zalo** (điện thoại) hoặc quét QR bằng Zalo (máy tính). Khi thử bản Testing, dùng deep link từ Extension, giữ tham số phiên bản và thêm `dkanLink` với mã dùng một lần lấy từ mục thủ công.
4. Trong Mini App bấm **Tiếp tục liên kết**, quay lại đúng tab website bấm **Xác nhận liên kết tài khoản Zalo này** trong 5 phút.
5. Mở lại Mini App: tự đăng nhập đúng hồ sơ. Thử với Mini App đã mở sẵn và khi mở lần đầu; dùng mã thủ công nếu liên kết trực tiếp không chuyển được ứng dụng.

Từ Mini App, mở mục **Cách khác: liên kết qua website** ở bước nhập email. Nút **Mở website liên kết** tải trang trong cửa sổ Zalo (WebView, có từ bản `LIVE-20261116.3`). Nếu cửa sổ không mở hoặc đăng nhập Microsoft bị chặn, Mini App báo lỗi và vẫn hiện địa chỉ trang ngay bên dưới: bấm **Sao chép địa chỉ**, dán vào Chrome hoặc Safari rồi làm tiếp từ bước 1. Ô **Mã liên kết trên website** trong cùng mục dùng cho mã thủ công.

Trên website, API vẫn trả `email_verification_required` cho email chưa xác minh, tách biệt với tài khoản bị khóa, sai tên miền hoặc sai phương thức đăng nhập ([tài liệu Firebase về email đã xác minh](https://firebase.google.com/docs/auth/users/#verified_email_addresses)).

## Khi không lấy được phiên Zalo

Hộp liên kết hiển thị **Mã hỗ trợ** đã lọc: bước tải SDK/lấy phiên, loại môi trường và mã lỗi số do SDK cấp nếu có; không có access token, nội dung lỗi thô, mã xác minh hoặc dữ liệu tài khoản. Gửi phần mã hỗ trợ kèm dòng phiên bản để đối chiếu.

SDK `-1401` có nhiều nguyên nhân về xác thực nên chưa đủ để kết luận sai App Secret; `-1403` (quyền API), `-1404` (phiên bản Zalo), `-1408` (quá thời gian chờ) xử lý theo mã thực tế. Không tự xin thêm quyền tên/ảnh/số điện thoại: `getAccessToken` từ SDK 2.35 đã hỗ trợ ID mặc định.

Nếu SDK lấy được phiên nhưng màn hình báo phiên xác thực chưa hợp lệ, lọc log theo đúng chuỗi `DKAN_ZALO_VERIFY_FAILED` (Runtime Logs của dự án Vercel `suatanapp`, hoặc `logs\api.log` trên VPS). Dòng này chỉ chứa bước xử lý, mã số Zalo, HTTP status và `providerReason` thuộc danh sách cố định (`ip_restricted`, `app_inactive`, `invalid_proof`, `invalid_token`, `unknown`). Không gửi toàn bộ log hay khóa qua chat.

Graph `/me` mã `-501` là IP gọi API nằm ngoài Việt Nam ([bảng mã lỗi Zalo Social](https://docs.zaloplatforms.com/docs/Social/social-api/tham-khao/ma-loi)), ánh xạ thành `ip_restricted`. Vercel [không có vùng compute Việt Nam](https://vercel.com/docs/regions), nên phần xác minh chạy trên [máy chủ Việt Nam](ZALO_VIETNAM_API.md); không đổi khóa chỉ để xử lý lỗi vùng IP.

Tham khảo: [hướng dẫn Extension](https://marketplace.visualstudio.com/items?itemName=zalo-mini-app.zalo-mini-app), [quy trình Testing và phát hành](https://docs.zaloplatforms.com/docs/MA/intro/public-mini-program), [getAccessToken](https://docs.zaloplatforms.com/docs/MA/api/user/user-information/getAccessToken), [mã lỗi SDK](https://docs.zaloplatforms.com/docs/MA/api/errorCode).
