declare module "react-gauge-chart" {
  import type { FC } from "react";
  interface GaugeChartProps {
    id?: string;
    nrOfLevels?: number;
    colors?: string[];
    arcWidth?: number;
    percent?: number;
    textColor?: string;
    needleColor?: string;
    needleBaseColor?: string;
    hideText?: boolean;
    formatTextValue?: (value: string) => string;
    style?: React.CSSProperties;
  }
  const GaugeChart: FC<GaugeChartProps>;
  export default GaugeChart;
}
