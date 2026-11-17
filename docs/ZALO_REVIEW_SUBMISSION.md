# Chuẩn bị quyền truy cập để xét duyệt Zalo Mini App

Áp dụng cho **Suất ăn Ngôi Sao Hoàng Mai**, Mini App ID `3378419117469948059`. Bản đầu đối chiếu mã nguồn và tài liệu Zalo ngày 06/11/2026; nay cập nhật theo luồng liên kết của bản `LIVE-20261117.1`. Đây là hướng dẫn chuẩn bị; chưa xác nhận đăng nhập bằng tài khoản kiểm duyệt trên hệ thống đang chạy và chưa gửi lại xét duyệt.

## Phản hồi cần xử lý

Kiểm duyệt viên yêu cầu cung cấp mã liên kết tạo bằng tài khoản trường và bổ sung cách truy cập vào **Mô tả bản cập nhật** khi gửi phiên bản xét duyệt.

Từ `LIVE-20261117.1`, kiểm duyệt viên tự liên kết được ngay trong Mini App bằng tài khoản Microsoft 365 riêng do trường cấp: nhập email của tài khoản đó, nhận mã 6 số trong hộp thư, nhập mã là liên kết và đăng nhập xong. Tuy nhiên, **một mã tạo sẵn rồi dán vào hồ sơ lúc nộp không dùng được**: mã gửi qua email hết hạn sau 10 phút, mã liên kết của website sau 5 phút, còn việc kiểm duyệt diễn ra sau thời điểm nộp. Thông tin truy cập ổn định là tài khoản M365 kiểm duyệt (kèm quyền đọc hộp thư của tài khoản đó) và hướng dẫn tự lấy mã mới lúc kiểm tra.

Phản hồi này trước hết cho thấy thiếu hướng dẫn/quyền truy cập để kiểm tra. Chưa có bằng chứng cần thay đổi cơ chế xác thực. Không kéo dài thời hạn mã, bỏ xác minh email/Microsoft, tự động xác nhận liên kết hoặc mở dữ liệu cá nhân cho người chưa liên kết để xử lý phản hồi.

## Thông tin cần điền riêng trước khi nộp

Giữ các giá trị dưới đây là chỗ trống trong kho mã. Chỉ điền bản dùng để nộp riêng cho nền tảng; không lưu mật khẩu, mã xác minh hoặc mã liên kết còn hiệu lực, OTP, token hoặc thư xác minh vào tài liệu này/Git/chat.

| Thông tin | Giá trị cần chuẩn bị |
| --- | --- |
| Tài khoản M365 dành riêng cho kiểm duyệt | `[EMAIL_TAI_KHOAN_KIEM_DUYET]` — tên miền `hoangmaistarschool.edu.vn`, đọc được hộp thư |
| Người phụ trách hỗ trợ | `[TEN_NGUOI_PHU_TRACH]` |
| Kênh liên hệ riêng và giờ hỗ trợ | `[KENH_LIEN_HE]`, `[GIO_HO_TRO_GMT_7]` |
| Phiên bản Testing gửi duyệt | `[MA_PHIEN_BAN]` |
| QR/đường dẫn do Zalo cấp cho phiên bản cần kiểm tra | `[QR_HOAC_DUONG_DAN_PHIEN_BAN]` |
| Cách bàn giao thông tin đăng nhập riêng | `[HUONG_DAN_KENH_BAN_GIAO_DA_THOA_THUAN]` — không chứa mật khẩu tại đây |

Tài khoản phải thuộc quyền quản lý của trường và dùng cho kiểm duyệt; không dùng tài khoản Microsoft cá nhân của quản trị viên. Kiểm tra quyền thực tế trên website: địa chỉ email được gọi là “tài khoản kiểm duyệt” không tự làm mất quyền quản trị sẵn có. Chỉ cấp các quyền cần để kiểm tra luồng cá nhân.

## Kiểm tra trước khi gửi lại

1. **Tài khoản và hộp thư:** tài khoản đã đăng nhập website suất ăn bằng Microsoft của trường ít nhất một lần (lần đó tạo tài khoản Suất ăn; chưa có thì Mini App báo chưa có tài khoản và không gửi thư), có nhà cung cấp `microsoft.com`, không bị khóa và đúng tên miền trường. Đăng nhập thử Outlook trên web (`https://outlook.office.com`) bằng tài khoản này và xác nhận nhận được thư từ hộp thư gửi của trường (kiểm tra cả mục Thư rác). Quyền quản trị website không thay thế các điều kiện này.
2. **MFA và chính sách M365:** thử từ trình duyệt/thiết bị và mạng bên ngoài trường. Xác định rõ MFA, đổi mật khẩu lần đầu, yêu cầu thiết bị được quản lý hoặc Conditional Access có khiến kiểm duyệt viên phải nhờ nhân viên trường mỗi lần đăng nhập hộp thư hay website hay không. Không mặc định người kiểm duyệt truy cập được chỉ vì nhân viên CNTT đăng nhập được. Nếu cần phối hợp, điền người phụ trách/giờ hỗ trợ và thống nhất với kiểm duyệt; không tắt chính sách toàn trường hoặc chia sẻ OTP trong hồ sơ.
3. **Hồ sơ cá nhân:** API tải hồ sơ từ `staff/{uid}` của chính tài khoản Firebase đã liên kết. Email M365 tồn tại chưa có nghĩa hồ sơ nghiệp vụ đầy đủ. Luồng nghiệp vụ kiểm tra họ tên, mã nhân viên dạng `10` cộng 4 chữ số và bộ phận; thiếu dữ liệu sẽ chặn các thao tác tương ứng. Quản trị phải kiểm tra hồ sơ được trường cho phép dùng để kiểm duyệt; không mượn mã nhân viên/hồ sơ của người khác hoặc tự tạo đơn suất ăn để lấp dữ liệu trống.
4. **Trạng thái liên kết:** mỗi tài khoản trường gắn với một tài khoản Zalo. Liên kết bằng mã email từ Zalo của kiểm duyệt viên sẽ thay Zalo đang gắn với tài khoản kiểm duyệt (Mini App báo trước ở bước nhập mã) và phiên của Zalo cũ hết hiệu lực ngay. Nếu tài khoản kiểm duyệt đã gắn với Zalo của người thử nội bộ, chủ tài khoản nên hủy liên kết trên website trước khi bàn giao để tránh nhầm lẫn. Đăng xuất Mini App không hủy liên kết. Không hủy tài khoản/người dùng khác, không xóa trực tiếp dữ liệu liên kết để né kiểm tra.
5. **Giới hạn gửi mã:** giới hạn tính chung cho mọi Zalo dùng cùng tài khoản: gửi lại sau 60 giây, tối đa 5 thư mỗi giờ và 10 thư mỗi 24 giờ; nhập sai tổng cộng 10 lần trong 24 giờ thì tài khoản bị từ chối mọi mã và không nhận thêm mã trong 24 giờ (khi đó chỉ còn đường website). Không thử gửi mã nhiều lần bằng tài khoản kiểm duyệt ngay trước khi nộp; sau lần thử nội bộ cuối, để trống ít nhất 24 giờ nếu đã gửi gần hết lượt.
6. **Website/API:** VPS `api-suatan.nshm.vn` đã chạy `server.cjs` của `LIVE-20261117.1` và có đủ cấu hình gửi thư, Vercel đã Redeploy — theo mục *Cập nhật LIVE-20261117.1* trong [hướng dẫn API Việt Nam](ZALO_VIETNAM_API.md); thiếu một trong hai thì Mini App báo lỗi máy chủ ngay ở bước gửi mã. Trang `https://suatanapp.vercel.app/lien-ket-zalo` mở được và popup Microsoft hoạt động (đường thay thế). Kiểm tra cả luồng thật trong Zalo; kiểm tra health/CORS riêng lẻ chưa chứng minh gửi thư, đăng nhập và hồ sơ hoạt động.
7. **Đúng phiên bản:** chọn phiên bản Testing cần gửi lại trong trang quản lý Zalo. Ghi đúng mã phiên bản và đường dẫn/QR của phiên bản đó; dòng `Phiên bản: LIVE-…` trong hộp liên kết tài khoản phải khớp. Không dùng QR Development của lần chạy cũ hoặc mặc định link Live đã có bản công khai. Việc mở bản Testing bằng tài khoản Developer/Admin nội bộ chưa chứng minh người ngoài có cùng quyền truy cập; nền tảng kiểm duyệt theo luồng nộp phiên bản.
8. **Giới hạn nghiệp vụ:** ghi nhận tháng nào mở đăng ký, hạn đăng ký/hủy, hạn chế theo email, sự kiện và khảo sát đang mở. Tài khoản kiểm duyệt vẫn chịu các điều kiện này. Màn hình rỗng hoặc nút bị khóa theo lịch cần được mô tả đúng; không thay đổi lịch trường, mở lại tháng hoặc tạo đăng ký/hủy/sự kiện/khảo sát thật chỉ để thử.

## Các bước để kiểm duyệt viên tự lấy mã mới

### Cách chính: mã gửi qua email, ngay trong Mini App

1. Mở đúng phiên bản Mini App được gửi xét duyệt bằng Zalo của người kiểm duyệt. Nếu Zalo này chưa liên kết, hộp **Kết nối đúng tài khoản của bạn** tự mở ở bước nhập email (nếu chưa mở, chọn **Liên kết bằng email nhà trường**).
2. Nhập email M365 kiểm duyệt (gõ phần trước `@hoangmaistarschool.edu.vn` hoặc cả địa chỉ), chọn **Gửi mã xác minh**. Màn hình chỉ hiện email đã che.
3. Đăng nhập `https://outlook.office.com` bằng cùng tài khoản, mở thư **Mã xác minh liên kết Zalo: ……** (xem cả Thư rác).
4. Trong 10 phút, nhập 6 số vào Mini App; đủ 6 số Mini App tự gửi. Kết quả mong đợi là hồ sơ của tài khoản kiểm duyệt, không phải hồ sơ của nhân viên khác. Hộp thư nhận thêm thư **Tài khoản Suất ăn vừa liên kết với Zalo**.
5. Mã sai: nhập lại; một mã chỉ được nhập sai 5 lần. Mã hết hạn hoặc chưa thấy thư: chờ hết đếm ngược 60 giây rồi chọn **Gửi lại mã**; mã mới thay mã cũ. Nhập nhầm email thì chọn **Đổi email**.

### Cách thay thế: mã liên kết của website

Dùng khi không đọc được hộp thư hoặc tài khoản đã hết lượt gửi mã. Nên mở website trên máy tính hoặc trình duyệt riêng, giữ tab đó nguyên trạng và dùng Zalo trên điện thoại.

1. Trong Mini App, ở bước nhập email chọn **Cách khác: liên kết qua website**.
2. Mở `https://suatanapp.vercel.app/lien-ket-zalo` trong trình duyệt và đăng nhập tài khoản M365 kiểm duyệt. Nếu trang yêu cầu xác minh email hoặc chính sách M365 ngăn đăng nhập, xử lý theo thông tin hỗ trợ đã cung cấp trước khi tạo mã.
3. Chọn **Bắt đầu liên kết**, mở mục **Dùng mã liên kết thủ công** và chọn **Sao chép mã**. Mã phân biệt chữ hoa/thường; dùng nút sao chép để tránh nhập sai.
4. Trong vòng 5 phút, dán mã vào ô **Mã liên kết trên website** của Mini App và chọn **Gửi mã liên kết**. Nhập mã chỉ tạo yêu cầu, chưa cấp quyền truy cập hồ sơ.
5. Quay lại tab website đang mở. Khi hiện **Có yêu cầu liên kết từ Zalo**, kiểm tra đây đúng là yêu cầu vừa gửi bằng Zalo của người kiểm duyệt rồi chọn **Xác nhận liên kết tài khoản Zalo này**. Không nhờ nhân viên trường xác nhận một yêu cầu Zalo không rõ nguồn gốc.
6. Trở lại Mini App và chờ hoàn tất; nếu được nhắc, chọn **Đăng nhập lại bằng Zalo**.
7. Nếu mã hết hạn: tạo mã mới trên website và nhập lại trong Mini App. Mã mới làm mã cũ đang chờ hết hiệu lực; không tạo liên tiếp nhiều mã. Giới hạn hiện tại là tối đa 5 lần tạo trong một cửa sổ 10 phút; nếu bị giới hạn, chờ qua cửa sổ đó rồi thử lại.

Sau khi liên kết thành công, liên kết không tự mất khi mã hết hạn. Phiên Mini App được cấp tối đa 8 giờ và chỉ lưu trong bộ nhớ; lần sau mở Mini App trong Zalo, ứng dụng tự đăng nhập nếu liên kết còn hiệu lực, không cần mã mới. Phiên vẫn bị từ chối nếu liên kết bị hủy/thu hồi hoặc tài khoản trường không còn hợp lệ.

Một tài khoản M365 chung không phục vụ nhiều Zalo kiểm duyệt đồng thời: liên kết từ Zalo khác sẽ thay Zalo trước và phiên của Zalo trước hết hiệu lực ngay. Nếu cần đổi người kiểm tra, thống nhất thời điểm chuyển; không âm thầm liên kết lại trong lúc một người khác đang kiểm tra.

## Mẫu cho “Mô tả bản cập nhật”

Chỉ dùng mẫu sau khi các bước chuẩn bị đã hoàn tất. Thay toàn bộ chỗ trống bằng thông tin đúng ở bản nộp riêng. Không viết “đã cung cấp” nếu chưa bàn giao; không dán mẫu có chỗ trống rồi gửi. Đây là nội dung hướng dẫn kiểm duyệt trong hồ sơ phiên bản, không phải phần mô tả công khai của Mini App.

```text
Suất ăn Ngôi Sao Hoàng Mai – Mini App ID 3378419117469948059
Phiên bản: [MA_PHIEN_BAN]

Ứng dụng phục vụ nội bộ cán bộ, giáo viên, nhân viên của nhà trường. Truy cập dữ liệu suất ăn cá nhân cần liên kết tài khoản Zalo với tài khoản Microsoft 365 do trường cấp.

Bổ sung hướng dẫn truy cập theo phản hồi kiểm duyệt:
- Tài khoản M365 dành riêng cho kiểm duyệt: [EMAIL_TAI_KHOAN_KIEM_DUYET] (đọc thư tại https://outlook.office.com).
- Cách nhận thông tin đăng nhập riêng: [HUONG_DAN_KENH_BAN_GIAO_DA_THOA_THUAN].
- Người hỗ trợ: [TEN_NGUOI_PHU_TRACH], [KENH_LIEN_HE], [GIO_HO_TRO_GMT_7].
- Bản cần kiểm tra: [QR_HOAC_DUONG_DAN_PHIEN_BAN].

Cách lấy mã xác minh mới ngay tại thời điểm kiểm tra:
1. Mở Mini App bằng Zalo. Hộp "Kết nối đúng tài khoản của bạn" tự mở ở bước nhập email.
2. Nhập email M365 kiểm duyệt ở trên, chọn "Gửi mã xác minh".
3. Đăng nhập https://outlook.office.com bằng cùng tài khoản, mở thư "Mã xác minh liên kết Zalo" (xem cả mục Thư rác).
4. Nhập 6 số vào Mini App. Mini App tự xác minh rồi hiện hồ sơ và chức năng cá nhân của tài khoản kiểm duyệt.

Mã chỉ có hiệu lực 10 phút; không dùng lại mã từ lần nộp trước. Khi hết hạn, chờ 60 giây rồi chọn "Gửi lại mã". Sau khi liên kết thành công, mở lại Mini App sẽ tự đăng nhập nếu liên kết vẫn còn hiệu lực.
Nếu không đọc được hộp thư: trong Mini App chọn "Cách khác: liên kết qua website", đăng nhập https://suatanapp.vercel.app/lien-ket-zalo bằng tài khoản kiểm duyệt, chọn "Bắt đầu liên kết", sao chép mã thủ công, dán vào ô "Mã liên kết trên website" của Mini App, rồi quay lại website chọn "Xác nhận liên kết tài khoản Zalo này". Mã website chỉ có hiệu lực 5 phút.

Trạng thái hồ sơ/dữ liệu có thể kiểm tra: [MO_TA_DUNG_HO_SO_VA_DU_LIEU_DA_CHUAN_BI].
Các giới hạn theo lịch đang áp dụng: [THANG_HAN_DANG_KY_HUY_SU_KIEN_KHAO_SAT].
Thao tác xác nhận đăng ký, hủy suất ăn, trả lời sự kiện hoặc khảo sát sẽ ghi vào dữ liệu vận hành của trường. Chưa có môi trường nghiệp vụ tách riêng cho tài khoản kiểm duyệt; vui lòng xem dữ liệu và các màn hình trước bước gửi/xác nhận. Nếu cần kiểm tra thao tác ghi, liên hệ người phụ trách để thống nhất phạm vi dữ liệu phù hợp trước khi thực hiện.
```

Nếu nền tảng chỉ chấp nhận mã do trường tạo và kiểm duyệt viên không thể tự đăng nhập M365, người phụ trách cần trao đổi trong kênh hồ sơ/hỗ trợ chính thức về thời điểm nhận mã. Với mã email, người phụ trách đọc mã trong hộp thư kiểm duyệt và chuyển qua kênh riêng đã thống nhất ngay lúc kiểm duyệt viên yêu cầu; không ghi mã vào hồ sơ. Chưa có cơ chế cấp mã dùng nhiều ngày hay quyền truy cập đặc biệt trong mã nguồn hiện tại. Không gửi lại chỉ với lời hứa “sẽ gửi mã khi cần” nếu chưa có phương thức phối hợp khả thi.

## Phạm vi xác nhận và tài liệu tham chiếu

- Tài liệu này đối chiếu `src/pages/ZaloAccountLink.tsx`, `miniapp/src/App.tsx`, `miniapp/src/components/AccountLinkPanel.tsx`, `miniapp/server/account-links.mjs`, `api/_lib/zalo-runtime.mjs`, `api/_lib/zalo-mail.mjs` và điều kiện hồ sơ trong `miniapp/server/meal-business.mjs`. Chưa đăng nhập thay người kiểm duyệt, gửi mã, thay tài khoản, liên kết Zalo, gửi thông báo hoặc ghi đơn nghiệp vụ.
- [Hướng dẫn phát hành Mini App của Zalo](https://docs.zaloplatforms.com/docs/MA/intro/public-mini-program): bản Testing được gửi xét duyệt, sau khi được duyệt mới có bước Publish. Gửi lại hồ sơ không đồng nghĩa ứng dụng đã được chấp thuận.
- [Chính sách kiểm duyệt Zalo Mini App](https://miniapp.zaloplatforms.com/documents/zalo-mini-app-censorship-policy/): mục 6.4 có trường hợp ứng dụng nội bộ trường học cần đăng nhập; mục 4.1 quy định về điều hướng ra ngoài. Cần trình bày trung thực bước đọc thư trong hộp thư trường và đường website thay thế, để nền tảng đánh giá luồng hiện có; không suy ra rằng tài khoản kiểm duyệt làm toàn bộ luồng được chấp thuận.
- [Các lỗi kỹ thuật thường gặp của Zalo](https://docs.zaloplatforms.com/docs/MA/intro/getting-started/frequently-solved-issues): đối chiếu lỗi HTTPS/CORS, quyền API và khác biệt giữa tài khoản Developer/Admin với người dùng khác khi thử trên thiết bị.

Xem thêm [hướng dẫn thử liên kết trên thiết bị](ZALO_DEVICE_TEST.md) và [đối chiếu dữ liệu vận hành](ZALO_LIVE_DATA.md). Một số mô tả phiên bản thử cũ dùng dữ liệu minh họa; khi nộp phải mô tả đúng bản đã chọn và API thực tế đang dùng.
