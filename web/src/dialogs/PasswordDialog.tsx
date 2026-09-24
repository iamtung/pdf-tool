import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Modal from "./Modal";

export default function PasswordDialog({ path, wrong, resolve }: { path: string; wrong: boolean; resolve: (pw: string | null) => void }) {
  const [pw, setPw] = useState("");
  const name = path.split("/").pop();
  return (
    <Modal title="File có mật khẩu" onClose={() => resolve(null)}
      actions={<>
        <Button variant="outline" onClick={() => resolve(null)}>Hủy</Button>
        <Button disabled={!pw} onClick={() => resolve(pw)}>Mở</Button>
      </>}>
      <p className="text-sm text-muted-foreground">
        Nhập mật khẩu để mở <b>{name}</b>. Mật khẩu chỉ giữ trong bộ nhớ, không lưu lại.
      </p>
      <div className="mt-3 space-y-1">
        <Label htmlFor="pdf-password" className="sr-only">Mật khẩu</Label>
        <Input id="pdf-password" type="password" autoFocus value={pw}
          onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && pw && resolve(pw)} />
      </div>
      {wrong && <div className="mt-1.5 text-xs text-destructive">Mật khẩu không đúng, thử lại.</div>}
    </Modal>
  );
}
