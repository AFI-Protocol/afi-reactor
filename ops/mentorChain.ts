import fs from 'fs';
import path from 'path';
import { CodexReplayResult } from '../types/CodexReplayResult.js';

interface MentorEvaluation {
  timestamp: string;
  codexHealth: {
    totalNodes: number;
    healthyNodes: number;
    issues: number;
    score: number; // 0-1 health score
  };
  dagPerformance: {
    lastSimulation: any;
    avgDuration: number;
    successRate: number;
  };
  agentReadiness: number; // 0-1 readiness score
}

export class MentorChain {
  static async evaluateSystem(): Promise<MentorEvaluation> {
    const codexLogPath = path.resolve('codex', 'codex.replay.log.json');
    const dagLogPath = path.resolve('tmp', 'dag-simulation.log.json');
    
    let codexHealth = { totalNodes: 0, healthyNodes: 0, issues: 0, score: 0 };
    let dagPerformance = { lastSimulation: null, avgDuration: 0, successRate: 1 };

    // Load Codex health data
    if (fs.existsSync(codexLogPath)) {
      const codexData = JSON.parse(fs.readFileSync(codexLogPath, 'utf-8'));
      codexHealth = {
        totalNodes: codexData.totalNodes || 0,
        healthyNodes: codexData.healthyNodes || 0,
        issues: codexData.issues || 0,
        score: codexData.totalNodes > 0 ? codexData.healthyNodes / codexData.totalNodes : 0
      };
    }

    // Load DAG performance data
    if (fs.existsSync(dagLogPath)) {
      const dagData = JSON.parse(fs.readFileSync(dagLogPath, 'utf-8'));
      dagPerformance = {
        lastSimulation: dagData,
        avgDuration: dagData.simulation?.duration || 0,
        successRate: dagData.simulation?.status === 'success' ? 1 : 0
      };
    }

    // Calculate overall agent readiness
    const agentReadiness = (codexHealth.score * 0.6) + (dagPerformance.successRate * 0.4);

    return {
      timestamp: new Date().toISOString(),
      codexHealth,
      dagPerformance,
      agentReadiness
    };
  }
}

// CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
  MentorChain.evaluateSystem().then(evaluation => {
    console.log('🧠 MentorChain Evaluation:');
    console.log(`📊 Codex Health: ${(evaluation.codexHealth.score * 100).toFixed(1)}%`);
    console.log(`⚡ DAG Success Rate: ${(evaluation.dagPerformance.successRate * 100).toFixed(1)}%`);
    console.log(`🎯 Agent Readiness: ${(evaluation.agentReadiness * 100).toFixed(1)}%`);
    
    const evalPath = path.resolve('tmp', 'mentor-evaluation.json');
    fs.writeFileSync(evalPath, JSON.stringify(evaluation, null, 2));
    console.log(`📝 Evaluation saved: ${evalPath}`);
  });
}