# Skynet — Glossary (Thuật ngữ)

Bảng thuật ngữ dùng trong [ROADMAP.md](ROADMAP.md), [ARCHITECTURE.md](ARCHITECTURE.md)
và [CONSTITUTION.md](../CONSTITUTION.md). Mỗi thuật ngữ giải thích ngắn gọn
trong 2 câu.

## Khái niệm sản phẩm

- **Agent Harness Engineering** — Kỷ luật kỹ thuật xây dựng "bộ khung"
  quanh agent CLI thô để làm nó *giỏi hơn*, không chỉ chạy nó. Gồm biên
  dịch chỉ dẫn, vai trò, ký ức và vòng lặp phản hồi để chất lượng tăng
  dần qua thời gian.
- **Worker (= Model + Role + Soul)** — Một "nhân sự AI" hoàn chỉnh, ghép
  từ ba lớp: mô hình nền, vai trò công việc và bản sắc riêng. Task được
  giao cho worker phù hợp nhất, không giao cho "một provider" chung
  chung.
- **Model** — CLI/nhà cung cấp nền (Codex, Antigravity, Claude Code)
  cùng thế mạnh riêng. Là lớp "năng lực thô" của worker.
- **Role (vai trò)** — Công việc của worker: PM / dev / QA / PO, kèm
  trách nhiệm, quyền hạn và definition of done. Trả lời câu hỏi "làm
  gì".
- **Soul (linh hồn)** — Bản sắc worker: tính cách, giá trị, gu code,
  chuẩn chất lượng, cùng ký ức bền vững lớn dần qua sprint. Soul là file
  đọc/sửa/version-control được — một tài sản chia sẻ được.
- **Best-worker matching** — Gán task theo điểm: thế mạnh model × độ
  khớp role × thành tích soul, quota còn lại làm tiêu chí phụ. Có giải
  thích "vì sao chọn worker này".
- **Quota-aware routing** — Định tuyến việc theo hạn mức subscription
  còn lại của từng tài khoản/provider. Điểm khác biệt số 1 vì chưa đối
  thủ nào làm.
- **Multi-account management** — Quản lý nhiều tài khoản cùng provider,
  mỗi tài khoản là một profile (thư mục config CLI riêng). Thay thế cách
  người dùng đang tự xử bằng shell alias.
- **ToS posture** — Tư thế tuân thủ điều khoản provider: giữ số phiên
  đồng thời và nhịp lệnh trong mức người thật tạo ra được, kèm
  kill-switch từng provider. Là ràng buộc thiết kế, không phải tính năng
  quảng cáo.

## Kiến trúc

- **Hexagonal Architecture (Ports & Adapters)** — Tách lõi nghiệp vụ
  thuần (không import `vscode`) khỏi thế giới ngoài. Mọi tiếp xúc bên
  ngoài đi qua interface (port) do adapter mỏng ở rìa hiện thực.
- **Port** — Interface mà lõi phụ thuộc, đại diện một "khe cắm" ra ngoài
  (ví dụ `AgentProvider`). Lõi chỉ biết port, không biết hiện thực cụ
  thể.
- **Adapter (lớp rìa)** — Code hiện thực port bằng công nghệ cụ thể
  (VSCode API, file mailbox, git worktree). Mỗi CLI một adapter riêng để
  cô lập sự bất ổn.
- **Dependency rule** — Module lõi chỉ import module lõi; chỉ lớp
  adapter được import `vscode`. Nhờ đó toàn bộ logic điều phối test được
  bằng vitest trong mili-giây.
- **Composition root** — Nơi duy nhất các class cụ thể được lắp ráp:
  `activate()` trong `extension.ts`. Nơi khác chỉ nhận dependency qua
  constructor.
- **Constructor injection** — Truyền dependency qua tham số constructor
  (kiểu là port), không dùng DI framework hay singleton ẩn. Phụ thuộc
  tường minh, test dễ.
- **Walking skeleton** — Phiên bản chạy được mỏng nhất xuyên suốt kiến
  trúc (lõi + port + một adapter + lệnh smoke test). Chứng minh cơ chế
  đầu-cuối trước khi mở rộng.

## Design patterns

- **Adapter pattern** — Bọc giao diện lạ/bất ổn (CLI từng hãng) sau
  interface thống nhất. Provider đổi format thì chỉ sửa một file
  adapter.
- **Registry** — `ProviderRegistry`: adapter đăng ký một lần lúc khởi
  động, nơi khác tra theo id. Thêm provider mới chỉ tốn một file + một
  dòng `register()`.
- **Strategy** — `MatchingStrategy`: thuật toán "task giao cho ai" nằm
  sau interface, thay được (ưu tiên cố định → quota → chấm điểm phù hợp)
  mà không sửa nơi gọi.
- **State machine** — `AgentSessionStateMachine`: bảng chuyển trạng thái
  tường minh (launching → ready → busy → awaiting-input →
  done/stopped/failed). Suy luận sai sẽ nổ lỗi "illegal transition" thay
  vì âm thầm hỏng board.
- **Observer** — Emitter sự kiện có kiểu: nhiều bên (sidebar, board,
  quota tracker) nghe sự kiện của một phiên. Subscription trả về
  `Disposable` khớp vòng đời VSCode.
- **Facade** — `extension.ts` che sự phức tạp lắp ráp; lệnh VSCode chỉ
  mỏng: nhận tham số, gọi lõi, hiển thị kết quả.
- **Mediator** — `Orchestrator`: worker không nói chuyện trực tiếp; mọi
  bàn giao (dev → QA, cổng PO, retro → soul) qua một trung gian để luật
  ceremony nằm một chỗ.
- **Builder** — `HarnessCompiler`: lắp briefing theo lớp (quy ước dự án +
  role + soul + bài học + đề bài) rồi render ra định dạng chỉ dẫn của
  từng CLI (CLAUDE.md / AGENTS.md / GEMINI.md).
- **Repository** — `WorkerStore`: role, soul, bài học, thành tích lưu
  dạng file sau một port. Nơi lưu (workspace/global) là việc của lớp
  rìa.
- **Pure-function parser** — Parser đọc file phiên (rollout JSONL,
  outbox JSON) là hàm thuần, test bằng fixture ghi từ file thật. Upstream
  đổi format thì fixture bắt được, không phải người dùng.

## Cơ chế tương tác

- **pty (pseudo-terminal)** — Terminal giả lập cho phép chạy chương
  trình tương tác như người gõ thật. Luật "pty-only" nghĩa là điều khiển
  agent qua terminal thật, không bao giờ qua headless flag hay SDK.
- **File-mailbox** — Cơ chế I/O đã kiểm chứng: doorbell → agent đọc
  `inbox/turn-N.md` → ghi `outbox/turn-N.json`. Tránh hoàn toàn việc đọc
  màn hình terminal.
- **Doorbell** — Câu lệnh ngắn gõ vào terminal (qua `sendText`) báo agent
  "có việc mới, đọc inbox". Là phía *ghi* — phía duy nhất API công khai
  của VSCode hỗ trợ.
- **Turn boundary** — Ranh giới một lượt làm việc, xác định bằng việc
  file outbox xuất hiện. Thay cho việc đoán "xong chưa" từ text màn
  hình.
- **TurnResult** — Kết quả một lượt mà port trả về: số lượt, nội dung
  phản hồi, snapshot usage nếu thu hoạch được.
- **Rollout harvest (`rollout-*.jsonl`)** — Đọc file log phiên mà chính
  CLI tự ghi để lấy session id và usage/quota. Dữ liệu có cấu trúc,
  không cần gọi API thêm.
- **Screen scraping** — Parse text thô trên màn hình terminal (kèm mã
  ANSI) để đoán trạng thái. Cách làm mong manh mà kiến trúc này cấm
  tuyệt đối.
- **`onDidWriteTerminalData`** — API VSCode đọc output terminal nhưng
  "proposed" vĩnh viễn (cần `--enable-proposed-api`). Extension trên
  Marketplace không dùng được cho người dùng thường.
- **node-pty** — Thư viện Node sở hữu pty trực tiếp, stream được output
  nhưng mong manh ABI (vỡ theo bản Electron/VSCode). Không trả giá
  trước; chỉ xét lại nếu trạng thái mịn thật sự cần.
- **Coarse status** — Trạng thái thô suy từ vòng đời mailbox (launching
  / ready / busy / awaiting-input / done). Là cái giá chấp nhận của
  file-mailbox cho MVP.
- **Git worktree isolation** — Mỗi agent làm trên worktree/branch riêng
  để không giẫm lên nhau. Diff được review trước khi merge.
- **Headless / `-p` / Agent SDK** — Bề mặt gọi agent tự động chính thức —
  thứ bị provider siết ToS và tính phí riêng. Skynet cấm dùng, thay bằng
  tương tác terminal.

## Scrum / quy trình

- **Epic** — Khối công việc lớn theo mục tiêu sản phẩm (E1–E8), gom
  nhiều feature. Mỗi epic có tiêu chí nghiệm thu riêng.
- **Feature (F)** — Một khả năng cụ thể trong epic (ví dụ F1.1 adapter
  Codex). Chia nhỏ thành các user story.
- **User Story (US)** — Yêu cầu dạng "Là [ai], tôi muốn [gì], để [lợi
  ích]". Đơn vị nhỏ nhất để ước lượng và nghiệm thu.
- **Ceremonies as control gates** — Nghi thức Scrum (review, duyệt PO,
  retro) cài thành *cổng kiểm soát chức năng*: diff phải qua duyệt mới
  đi tiếp. Không phải dashboard trang trí.
- **Retro flywheel** — Vòng đà cải tiến: bài học từ retrospective ghi
  ngược vào soul của worker chịu trách nhiệm (bạn duyệt). Đội giỏi lên
  qua từng sprint.
- **Standup summary** — Tóm tắt done / doing / blocked của mọi worker từ
  lần tổng hợp trước. Đọc một lần thay vì cuộn nhiều terminal.
- **Definition of Done** — Tiêu chí khách quan để task/role được coi là
  hoàn thành, gắn vào từng role.
- **Kanban board** — Bảng webview hiển thị task theo cột (backlog / in
  progress / review / done) kèm worker đang xử lý. Nơi bạn "chạy sprint"
  ngay trong IDE.
