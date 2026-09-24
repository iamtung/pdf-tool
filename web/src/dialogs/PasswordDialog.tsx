import { useState } from "react";
import Modal from "./Modal";

export default function PasswordDialog({ path, wrong, resolve }: { path: string; wrong: boolean; resolve: (pw: string | null) => void }) {
  const [pw, setPw] = useState("");
  const name = path.split("/").pop();
  return (
    <Modal title="File có mật khẩu" onClose={() => resolve(null)}
      actions={<><button onClick={() => resolve(null)}>Hủy</button><button className="primary" disabled={!pw} onClick={() => resolve(pw)}>Mở</button></>}>
      <p className="muted">Nhập mật khẩu để mở <b>{name}</b>. Mật khẩu chỉ giữ trong bộ nhớ, không lưu lại.</p>
      <input type="password" autoFocus value={pw} style={{ width: "100%" }}
        onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && pw && resolve(pw)} />
      {wrong && <div className="error-text" style={{ marginTop: 6 }}>Mật khẩu không đúng, thử lại.</div>}
    </Modal>
  );
}
