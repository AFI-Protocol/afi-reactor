export default {
  run: async (signal: any) => {
    console.log("👷 Stub: dao-checkpoint-verifier running...");
    signal.approvalStatus = "approved"; // mock behavior
    return signal;
  },
};