type ApprovalDecision = "approve" | "reject";

interface ApprovalGate {
  promise: Promise<ApprovalDecision>;
  resolve: (decision: ApprovalDecision) => void;
}

export class ApprovalGateRegistry {
  private gates = new Map<string, ApprovalGate>();

  wait(runId: string): Promise<ApprovalDecision> {
    const existing = this.gates.get(runId);
    if (existing) return existing.promise;

    let resolve!: (decision: ApprovalDecision) => void;
    const promise = new Promise<ApprovalDecision>((r) => {
      resolve = r;
    });
    this.gates.set(runId, { promise, resolve });
    return promise;
  }

  complete(runId: string, decision: ApprovalDecision): boolean {
    const gate = this.gates.get(runId);
    if (!gate) return false;
    gate.resolve(decision);
    this.gates.delete(runId);
    return true;
  }

  has(runId: string): boolean {
    return this.gates.has(runId);
  }
}
