# Gửi thử bằng trang client

1. Quản trị mở **Clients → Thêm client** (modal), chọn máy bằng dropdown checkbox và lưu. Sao chép API key trong modal hiện một lần; key không xuất hiện trong toast.
2. Client mở `http://EDATEC_IP:8081/client`, nhập key rồi bấm **Kết nối**. Không dùng mật khẩu quản trị hay SSH.
3. Chọn máy, chọn PDF/ZPL, kiểm tra số bản và tùy chọn thực sự được cấp cho máy rồi bấm **Gửi lệnh in**. Đây là lệnh in thật, không phải xem trước. Các định dạng chỉ theo cấu hình máy; trang không chuyển PDF thành ZPL hay cài driver. Tùy chọn được sinh từ schema CUPS/driver riêng từng máy; “Dùng mặc định” bỏ hẳn ghi đè khỏi yêu cầu.
4. Theo dõi **Lệnh của client**. Lệnh đang xử lý cập nhật mỗi 4 giây; nếu mất kết nối, bấm **Làm mới**. Lịch sử và máy in chỉ thuộc quyền của client đang dùng key.

## Khi có lỗi

- **Không có máy:** nhờ quản trị cấp quyền trong tab Clients.
- **API key không hợp lệ:** kiểm tra key, hoặc nhờ quản trị cấp key mới. Key bị thu hồi/xóa không dùng được.
- **Máy tạm dừng / lệnh đang giữ:** người vận hành kiểm tra máy và cho tiếp tục. Client không có quyền bỏ qua tạm dừng.
- **File/tùy chọn không phù hợp:** chỉ gửi PDF hoặc UTF-8 ZPL đúng định dạng. Chỉ chọn giá trị driver thật sự hiển thị; trang không cung cấp điều khiển PDF cho ZPL. Xem [hướng dẫn tùy chọn theo driver](print-options.md) để biết cách quản trị cấu hình schema, khác biệt fit/fill và giới hạn constraint.
- **Hết thời gian chờ / mất phản hồi / lỗi server khi gửi:** lệnh có thể đã được nhận. Trang khóa form và giữ nguyên file/tham số/mã yêu cầu; bấm **Gửi lại cùng yêu cầu** để kiểm tra/nhận lại mà không tạo lệnh trùng. Không đóng tab hoặc tạo một lệnh mới để “retry”. Nếu đã đóng tab, kiểm tra lịch sử/nhờ quản trị xác minh trước khi in lại.
- **Chưa rõ kết quả:** cần quản trị kiểm tra bằng chứng hệ thống in. Không tự gửi lại. Cấu hình hoặc lựa chọn in không thể thay thế xác minh trạng thái CUPS.
- **Hoàn thành (CUPS):** hệ thống in báo hoàn thành, không bảo đảm giấy đã ra trên mọi model.

## Bảo mật

API key chỉ nằm trong bộ nhớ của tab; tải lại hoặc ngắt kết nối phải nhập lại. Không dán key vào URL, issue công khai hay ảnh chụp. Trình duyệt có thể đề nghị lưu mật khẩu: không lưu API key trên máy dùng chung. HTTP không mã hóa key; chỉ dùng LAN đáng tin cậy, không mở cổng ra Internet.

Trang client không thay thế tích hợp API của ứng dụng nghiệp vụ. Nó giúp kiểm tra nhanh quyền, file và trạng thái trước khi tích hợp Odoo/PDA.
