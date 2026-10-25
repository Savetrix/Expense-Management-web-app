import Image from "next/image";

// Section 2: "What happens after you hit forward." Three steps on a 16.5s loop.
export function HowItWorks() {
  return (
    <section className="sec" id="how">
      {" "}
      <div className="wrap">
        {" "}
        <div className="sec-top">
          {" "}
          <p className="eyebrow">How it works</p>
          {" "}
          <h2 className="h2">
            What happens after you hit forward
            <i className="pd">.</i>
          </h2>
          {" "}
        </div>
        {" "}
        <div className="vgrid">
          {" "}
          <div className="relay" aria-hidden="true">
            <span className="rl-line" />
            <span className="rl-fill" />
            <span className="rl-trk">
              <i />
            </span>
          </div>
          {" "}
          <article className="vg" id="email">
            {" "}
            <div className="vstage" aria-hidden="true">
              {" "}
              <div className="scene">
                {" "}
                <span className="v1-gate">
                  <span className="v1-gate-l">
                    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z">
                      </path>
                      <path d="m9 12 2 2 4-4" />
                    </svg>
                    Approved senders only
                  </span>
                </span>
                {" "}
                <span className="mchip v1-chip v1a">
                  <svg width={14} height={14}>
                    <use href="#ic-mail" />
                  </svg>
                  Fwd: Invoice INV-20418
                </span>
                {" "}
                <span className="mchip v1-chip v1b">
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                    <path d="M14 3v5h5" />
                  </svg>
                  northwind-july.pdf
                </span>
                {" "}
                <span className="mchip v1-chip v1c">
                  <svg width={14} height={14}>
                    <use href="#ic-phone" />
                  </svg>
                  Photo of a paper invoice
                </span>
                {" "}
                <div className="v1-tray">
                  {" "}
                  <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 12h-6l-2 3h-4l-2-3H2" />
                    <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
                  </svg>
                  {" "}
                  <span className="v1-tray-t">
                    <b>Your ScanTrix inbox</b>
                    <span>One address per company</span>
                  </span>
                  {" "}
                  <span className="v1-led" />
                  {" "}
                </div>
                {" "}
              </div>
              {" "}
            </div>
            {" "}
            <div className="vtext">
              {" "}
              <span className="vn">01</span>
              {" "}
              <h3 className="vt">
                You forward
                {" "}
                <span className="nw">
                  it
                  <i className="pd sl sl1">.</i>
                </span>
              </h3>
              {" "}
              <p className="vd">Forward to your company’s ScanTrix address, drop in a PDF or snap a photo. Only approved senders get in.</p>
              {" "}
            </div>
            {" "}
          </article>
          {" "}
          <article className="vg">
            {" "}
            <div className="vstage" aria-hidden="true">
              {" "}
              <div className="scene">
                {" "}
                <div className="v2-doc">
                  {" "}
                  <i style={{ left: "14px", top: "18px", width: "62px", height: "7px", background: "#C9D8D3" }} />
                  {" "}
                  <i style={{ left: "14px", top: "36px", width: "44px" }} />
                  {" "}
                  <i style={{ left: "14px", top: "62px", width: "58px" }} />
                  <i style={{ left: "92px", top: "62px", width: "22px" }} />
                  {" "}
                  <i style={{ left: "14px", top: "78px", width: "50px" }} />
                  <i style={{ left: "92px", top: "78px", width: "22px" }} />
                  {" "}
                  <i style={{ left: "14px", top: "94px", width: "54px" }} />
                  <i style={{ left: "92px", top: "94px", width: "22px" }} />
                  {" "}
                  <i style={{ left: "14px", top: "114px", width: "100px", height: "1px" }} />
                  {" "}
                  <i style={{ left: "14px", top: "134px", width: "30px", height: "5px" }} />
                  <i style={{ left: "78px", top: "133px", width: "36px", height: "7px", background: "#C9D8D3" }} />
                  {" "}
                  <i style={{ left: "14px", top: "156px", width: "70px", height: "3px" }} />
                  {" "}
                  <span className="v2-scan" />
                  {" "}
                  <span className="bx bx1" />
                  <span className="bx bx2" />
                  <span className="bx bx3" />
                  {" "}
                </div>
                {" "}
                <span className="vs" style={{ top: "8px" }}>
                  <em>Vendor</em>
                  <i style={{ width: "132px" }} />
                </span>
                {" "}
                <span className="vs" style={{ top: "58px" }}>
                  <em>Date</em>
                  <i style={{ width: "88px" }} />
                </span>
                {" "}
                <span className="vs" style={{ top: "118px" }}>
                  <em>Total</em>
                  <i style={{ width: "64px" }} />
                </span>
                {" "}
                <span className="vv vv1">
                  <em>Vendor</em>
                  <b>Northwind Supplies</b>
                </span>
                {" "}
                <span className="vv vv2">
                  <em>Date</em>
                  <b>Jul 22, 2026</b>
                </span>
                {" "}
                <span className="vv vv3">
                  <em>Total</em>
                  <b>$783.50</b>
                </span>
                {" "}
                <span className="v2-ck v2-ck1">
                  <i />
                  Vendor matched
                </span>
                {" "}
                <span className="v2-ck v2-ck2">
                  <i />
                  No duplicate
                </span>
                {" "}
              </div>
              {" "}
            </div>
            {" "}
            <div className="vtext">
              {" "}
              <span className="vn">02</span>
              {" "}
              <h3 className="vt">
                ScanTrix reads
                {" "}
                <span className="nw">
                  it
                  <i className="pd sl sl2">.</i>
                </span>
              </h3>
              {" "}
              <p className="vd">Every field and every line. The vendor is matched and duplicates are caught before anything posts.</p>
              {" "}
            </div>
            {" "}
          </article>
          {" "}
          <article className="vg">
            {" "}
            <div className="vstage" aria-hidden="true">
              {" "}
              <div className="scene">
                {" "}
                <div className="v3-in">
                  {" "}
                  <div className="v3-led">
                    {" "}
                    <div className="v3-hd">
                      {" "}
                      <span className="v3-hd-t">Bills</span>
                      {" "}
                      <span className="v3-dest">
                        {" "}
                        <span className="v3-d v3-dq">
                          <svg width={14} height={14}>
                            <use href="#lg-qb" />
                          </svg>
                          QuickBooks
                        </span>
                        {" "}
                        <span className="v3-d v3-dx">
                          <svg width={14} height={14}>
                            <use href="#lg-xero" />
                          </svg>
                          Xero
                        </span>
                        {" "}
                      </span>
                      {" "}
                    </div>
                    {" "}
                    <div className="v3-rows">
                      {" "}
                      <div className="v3-row v3-r0">
                        <span>Northwind Supplies</span>
                        <b>$783.50</b>
                        <em>Posted</em>
                      </div>
                      {" "}
                      <div className="v3-row v3-r1">
                        <span>Kestrel Supply</span>
                        <b>$129.00</b>
                        <em>Posted</em>
                      </div>
                      {" "}
                      <div className="v3-row v3-r2">
                        <span>Metro Power</span>
                        <b>$86.40</b>
                        <em>Posted</em>
                      </div>
                      {" "}
                      <div className="v3-row v3-r3">
                        <span>Larch Studio</span>
                        <b>$54.12</b>
                        <em>Posted</em>
                      </div>
                      {" "}
                    </div>
                    {" "}
                  </div>
                  {" "}
                  <div className="v3-file">
                    {" "}
                    <span className="v3-file-l">Original</span>
                    {" "}
                    <span className="v3-folder">
                      <Image src="/brand/google-drive.png" alt="" width={14} height={14} />
                      <svg width={17} height={17}>
                        <use href="#lg-od" />
                      </svg>
                      Drive · OneDrive
                      <span className="okdot v3-tick" />
                    </span>
                    {" "}
                  </div>
                  {" "}
                  <span className="v3-fly" />
                  {" "}
                </div>
                {" "}
              </div>
              {" "}
            </div>
            {" "}
            <div className="vtext">
              {" "}
              <span className="vn">03</span>
              {" "}
              <h3 className="vt">
                Your books get
                {" "}
                <span className="nw">
                  it
                  <i className="pd sl sl3">.</i>
                </span>
              </h3>
              {" "}
              <p className="vd">The bill lands in QuickBooks or Xero. The original lands in Google Drive or OneDrive.</p>
              {" "}
            </div>
            {" "}
          </article>
          {" "}
        </div>
        {" "}
        <p className="trust">
          <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z">
            </path>
            <path d="m9 12 2 2 4-4" />
          </svg>
          <span>
            <b>Forwarding is locked down.</b>
            {" "}
            Approved senders only, SPF, DKIM and DMARC checked, and anything that fails a virus scan is refused.
          </span>
        </p>
        {" "}
      </div>
      {" "}
    </section>
  );
}
