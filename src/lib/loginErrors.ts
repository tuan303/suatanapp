/** Fixed user-facing messages; never expose raw OAuth errors or tokens. */
export function microsoftLoginErrorMessage(error: unknown): string {
  const details = error && typeof error === 'object' ? error as { code?: unknown; message?: unknown } : {};
  const code = typeof details.code === 'string' ? details.code : '';
  switch (code) {
    case 'auth/popup-blocked':
      return 'Trình duyệt đang chặn cửa sổ đăng nhập Microsoft. Nhấn biểu tượng cửa sổ bị chặn trên thanh địa chỉ, cho phép cửa sổ bật lên cho trang này, rồi bấm đăng nhập lại.';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Chưa hoàn tất đăng nhập Microsoft. Vui lòng bấm đăng nhập lại khi sẵn sàng.';
    case 'auth/unauthorized-domain':
      return 'Tên miền này chưa được cấp phép đăng nhập. Vui lòng liên hệ bộ phận CNTT để kiểm tra cấu hình Firebase.';
    case 'auth/configuration-not-found':
    case 'auth/operation-not-allowed':
      return 'Đăng nhập Microsoft chưa được cấu hình đầy đủ. Vui lòng liên hệ bộ phận CNTT.';
    case 'auth/network-request-failed':
      return 'Chưa kết nối được dịch vụ đăng nhập Microsoft. Vui lòng kiểm tra mạng rồi thử lại.';
    case 'auth/too-many-requests':
      return 'Có quá nhiều yêu cầu đăng nhập. Vui lòng đợi một lát rồi thử lại.';
  }
  if (typeof details.message === 'string' && details.message.includes('AADSTS7000215')) {
    return 'Cấu hình đăng nhập Microsoft của nhà trường cần được kiểm tra lại. Vui lòng liên hệ bộ phận CNTT.';
  }
  return 'Chưa đăng nhập được. Vui lòng thử lại hoặc liên hệ bộ phận CNTT để được hỗ trợ.';
}
