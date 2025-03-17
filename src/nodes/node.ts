import bodyParser from "body-parser";
import express from "express";
import { BASE_NODE_PORT } from "../config";
import { NodeState, Value, Message } from "../types";

export async function node(
  nodeId: number,
  N: number,
  F: number,
  initialValue: Value,
  isFaulty: boolean,
  nodesAreReady: () => boolean,
  setNodeIsReady: (index: number) => void
) {
  const node = express();
  node.use(express.json());
  node.use(bodyParser.json());

  let state: NodeState = {
    killed: false,
    x: isFaulty ? null : initialValue,
    decided: isFaulty ? null : false,
    k: isFaulty ? null : 0,
  };

  let round = 0;
  let proposals: Value[] = [];
  let votes: Value[] = [];

  node.get("/status", (req, res) => {
    if (isFaulty) {
      res.status(500).send("faulty");
    } else {
      res.status(200).send("live");
    }
  });

  node.get("/getState", (req, res) => {
    res.json(state);
  });

  node.get("/start", async (req, res) => {
    if (!state.killed && !isFaulty) {
      res.status(200).send("started");
      
      while (!state.decided && !state.killed) {
        if (nodesAreReady()) {
          // Phase 1: Proposal
          const proposal: Message = {
            type: "proposal",
            value: state.x!,
            round,
          };
          await sendMessageToAllNodes(proposal);
          await delay(200);

          // Process proposals
          const proposalCounts = countVotes(proposals);
          const totalProposals = proposalCounts[0] + proposalCounts[1];
          
          if (proposalCounts[0] > totalProposals / 2) {
            state.x = 0;
          } else if (proposalCounts[1] > totalProposals / 2) {
            state.x = 1;
          } else {
            state.x = Math.random() < 0.5 ? 0 : 1;
          }

          // Phase 2: Voting
          const vote: Message = {
            type: "vote",
            value: state.x,
            round,
          };
          await sendMessageToAllNodes(vote);
          await delay(200);

          // Process votes
          const voteCounts = countVotes(votes);
          const totalVotes = voteCounts[0] + voteCounts[1];

          if (voteCounts[0] > (2 * totalVotes) / 3) {
            state.x = 0;
            state.decided = true;
          } else if (voteCounts[1] > (2 * totalVotes) / 3) {
            state.x = 1;
            state.decided = true;
          }

          state.k = state.k! + 1;
          round++;
          proposals = [];
          votes = [];
        }
        await delay(200);
      }
    } else {
      res.status(400).send("node is killed or faulty");
    }
  });

  node.get("/stop", (req, res) => {
    state.killed = true;
    res.status(200).send("stopped");
  });

  node.post("/message", (req, res) => {
    if (!state.killed && !isFaulty) {
      const message: Message = req.body;
      if (message.round === round) {
        if (message.type === "proposal") {
          proposals.push(message.value);
        } else if (message.type === "vote") {
          votes.push(message.value);
        }
      }
      res.status(200).send("message received");
    } else {
      res.status(400).send("node is killed or faulty");
    }
  });

  const server = node.listen(BASE_NODE_PORT + nodeId, async () => {
    console.log(`Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}`);
    setNodeIsReady(nodeId);
  });

  return server;

  async function sendMessageToAllNodes(message: Message) {
    const promises = [];
    for (let i = 0; i < N; i++) {
      if (i !== nodeId) {
        promises.push(
          fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(message),
          }).catch(() => {}) // Ignore failed requests
        );
      }
    }
    await Promise.all(promises);
  }

  function countVotes(votes: Value[]): { [key: number]: number } {
    return votes.reduce(
      (acc, vote) => {
        if (typeof vote === "number") {
          acc[vote] = (acc[vote] || 0) + 1;
        }
        return acc;
      },
      { 0: 0, 1: 0 }
    );
  }

  function delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}