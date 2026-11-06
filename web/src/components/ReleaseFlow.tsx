import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Check, Code2, Fingerprint, Globe2, HardDrive } from "lucide-react";

const steps = [
  { label: "Source", detail: "Commit starts the build", icon: Code2, tone: "violet" },
  { label: "Artifact", detail: "Files receive a CID", icon: HardDrive, tone: "cyan" },
  { label: "Approval", detail: "Owner signs the release", icon: Fingerprint, tone: "mint" },
  { label: "ENS name", detail: "Resolver points to it", icon: Globe2, tone: "lime" },
];

export function ReleaseFlow() {
  const reduceMotion = useReducedMotion();
  return <div className="release-flow" aria-label="ENSure release path">
    <div className="flow-card-head">
      <div><p className="flow-label">DEPLOYMENT PATH <span>· 4 CHECKPOINTS</span></p><h2>From commit to<br />owner approved.</h2></div>
      <div className="flow-ready"><span className="flow-ready-light" /> READY</div>
    </div>
    <p className="flow-caption">A readable chain of custody for every production change.</p>

    <div className="flow-stages">
      <div className="flow-connector" aria-hidden="true"><div className="flow-connector-scan" /></div>
      {steps.map(({ label, detail, icon: Icon, tone }, index) => <motion.div
        key={label}
        className={`flow-stage flow-stage-${tone}`}
        initial={reduceMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduceMotion ? 0 : .42, delay: reduceMotion ? 0 : .12 + index * .09, ease: "easeOut" }}
        whileHover={reduceMotion ? undefined : { y: -3, transition: { duration: .18 } }}
      >
        <div className="flow-stage-top"><span className="flow-stage-number">0{index + 1}</span><span className="flow-stage-state">{index === 3 ? "ON ENS" : "VERIFIED"}</span></div>
        <div className="flow-stage-icon"><Icon aria-hidden="true" /></div>
        <div className="flow-stage-title">{label}<Check aria-hidden="true" className="flow-stage-check" /></div>
        <div className="flow-stage-detail">{detail}</div>
        {index < steps.length - 1 && <ArrowRight aria-hidden="true" className="flow-stage-arrow" />}
      </motion.div>)}
    </div>

    <div className="flow-foot"><span className="flow-foot-mark"><Fingerprint aria-hidden="true" /></span><span>One release. Exact bytes. Explicit authority.</span><span className="flow-foot-code">ENS / 001</span></div>
    {!reduceMotion && <motion.div className="flow-scanline" aria-hidden="true" initial={{ opacity: 0 }} animate={{ opacity: [0, .7, 0], x: ["-15%", "115%"] }} transition={{ duration: 5.5, repeat: Infinity, repeatDelay: 2, ease: "easeInOut" }} />}
  </div>;
}
