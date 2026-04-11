import { createWebsiteInquiryPostHandler } from "./handler";

export async function POST(req: Request) {
  const [{ intakeWebsiteInquiry }] = await Promise.all([
    import("@/src/services/website-inquiries"),
  ]);

  return createWebsiteInquiryPostHandler({
    intakeWebsiteInquiry,
  })(req);
}
