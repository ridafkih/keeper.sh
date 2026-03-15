const LAYERS = [
  { z: 1, mask: "linear-gradient(to top, rgba(0,0,0,0) 0%, rgb(0,0,0) 12.5%, rgb(0,0,0) 25%, rgba(0,0,0,0) 37.5%)", blur: "blur(0.234375px)" },
  { z: 2, mask: "linear-gradient(to top, rgba(0,0,0,0) 12.5%, rgb(0,0,0) 25%, rgb(0,0,0) 37.5%, rgba(0,0,0,0) 50%)", blur: "blur(0.46875px)" },
  { z: 3, mask: "linear-gradient(to top, rgba(0,0,0,0) 25%, rgb(0,0,0) 37.5%, rgb(0,0,0) 50%, rgba(0,0,0,0) 62.5%)", blur: "blur(0.9375px)" },
  { z: 4, mask: "linear-gradient(to top, rgba(0,0,0,0) 37.5%, rgb(0,0,0) 50%, rgb(0,0,0) 62.5%, rgba(0,0,0,0) 75%)", blur: "blur(1.875px)" },
  { z: 5, mask: "linear-gradient(to top, rgba(0,0,0,0) 50%, rgb(0,0,0) 62.5%, rgb(0,0,0) 75%, rgba(0,0,0,0) 87.5%)", blur: "blur(3.75px)" },
  { z: 6, mask: "linear-gradient(to top, rgba(0,0,0,0) 62.5%, rgb(0,0,0) 75%, rgb(0,0,0) 87.5%, rgba(0,0,0,0) 100%)", blur: "blur(7.5px)" },
  { z: 7, mask: "linear-gradient(to top, rgba(0,0,0,0) 75%, rgb(0,0,0) 87.5%, rgb(0,0,0) 100%)", blur: "blur(15px)" },
  { z: 8, mask: "linear-gradient(to top, rgba(0,0,0,0) 87.5%, rgb(0,0,0) 100%)", blur: "blur(30px)" },
];

export function StaggeredBackdropBlur() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden -bottom-full">
      {LAYERS.map(({ z, mask, blur }) => (
        <div
          key={z}
          className="absolute inset-0 pointer-events-none"
          style={{ zIndex: z, maskImage: mask, backdropFilter: blur }}
        />
      ))}
    </div>
  );
}
