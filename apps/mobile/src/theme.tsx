import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useColorScheme } from "react-native";

export type Appearance = "device" | "light" | "dark";
const palettes = {
  light: {
    canvas: "#F4F6FF",
    surface: "#FFFFFF",
    ink: "#17213B",
    muted: "#566380",
    brand: "#253FC7",
    onBrand: "#FFFFFF",
    tint: "#E9EDFF",
    border: "#8996B5",
    error: "#B02B46",
  },
  dark: {
    canvas: "#0D1324",
    surface: "#151E33",
    ink: "#F1F4FF",
    muted: "#B3BED8",
    brand: "#ACBAFF",
    onBrand: "#12215B",
    tint: "#253153",
    border: "#687B9E",
    error: "#FFB3C0",
  },
};
const ThemeContext = createContext({
  colors: palettes.light,
  dark: false,
  appearance: "device" as Appearance,
  setAppearance: (_value: Appearance) => {},
  preferenceError: "",
});
const preferenceKey = "nmt.device.appearance";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const device = useColorScheme();
  const [appearance, setPreference] = useState<Appearance>("device");
  const [preferenceError, setPreferenceError] = useState("");
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(preferenceKey)
      .then((value) => {
        if (
          active &&
          (value === "device" || value === "light" || value === "dark")
        )
          setPreference(value);
      })
      .catch(() => {
        if (active)
          setPreferenceError(
            "Appearance could not be restored. Choose it again below.",
          );
      });
    return () => {
      active = false;
    };
  }, []);
  const dark =
    appearance === "dark" || (appearance === "device" && device === "dark");
  const setAppearance = (value: Appearance) => {
    setPreference(value);
    setPreferenceError("");
    void AsyncStorage.setItem(preferenceKey, value).catch(() =>
      setPreferenceError(
        "Appearance changed for now. It could not be saved on this device.",
      ),
    );
  };
  return (
    <ThemeContext.Provider
      value={{
        colors: palettes[dark ? "dark" : "light"],
        dark,
        appearance,
        setAppearance,
        preferenceError,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}
export const useTheme = () => useContext(ThemeContext);
