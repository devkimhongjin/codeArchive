import { render, screen } from "@testing-library/react";
import { Popup } from "./Popup";

describe("Popup", () => {
  it("renders the local-first status without a server connection", () => {
    render(<Popup />);

    expect(screen.getByRole("heading", { name: "로컬 우선 기록 준비 완료" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("서버 연결 없음 · 로컬 프로토타입");
  });
});