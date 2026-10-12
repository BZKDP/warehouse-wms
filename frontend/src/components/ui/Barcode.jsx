import { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';

export default function Barcode({ value, width = 2, height = 60, className }) {
  const svgRef = useRef(null);

  useEffect(() => {
    if (!svgRef.current || !value) return;
    try {
      JsBarcode(svgRef.current, value, {
        format: 'CODE128',
        width,
        height,
        displayValue: true,
        fontSize: 12,
        margin: 10,
        background: '#ffffff',
      });
    } catch (e) {
      // invalid value
    }
  }, [value, width, height]);

  if (!value) return null;
  return <svg ref={svgRef} className={className} />;
}
