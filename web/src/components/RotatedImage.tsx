import type { ReactNode } from "react";

/**
 * Draws an unrotated page image inside a box of the *rotated* size (width x height),
 * applying the plan rotation with a CSS transform. Children are overlaid in the
 * unrotated coordinate space so they rotate together with the image.
 */
export default function RotatedImage({
  src, width, height, rotate, children, alt = "",
}: { src: string | null; width: number; height: number; rotate: number; children?: ReactNode; alt?: string }) {
  const sideways = rotate % 180 !== 0;
  const w = sideways ? height : width;
  const h = sideways ? width : height;
  return (
    <div style={{ position: "relative", width, height, overflow: "hidden" }}>
      <div
        style={{
          position: "absolute", left: (width - w) / 2, top: (height - h) / 2, width: w, height: h,
          transform: rotate ? `rotate(${rotate}deg)` : undefined,
        }}
      >
        {src && <img src={src} alt={alt} draggable={false} style={{ width: "100%", height: "100%", display: "block" }} />}
        {children}
      </div>
    </div>
  );
}
