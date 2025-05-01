"use server";

import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { tool } from "@langchain/core/tools";
import { ChatWatsonx } from "@langchain/community/chat_models/ibm";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { JSONSchemaToZod } from "@dmitryrechkin/json-schema-to-zod";

// Connect to the LLM provider
const model = new ChatWatsonx({
  model: "mistralai/mistral-large",
  projectId: process.env.WATSONX_AI_PROJECT_ID,
  serviceUrl: process.env.WATSONX_AI_ENDPOINT,
  version: "2024-05-31",
  temperature: 1,
  maxTokens: 800,
});

// Initialize the client
const client = new MultiServerMCPClient({
  mcpServers: {
    ["graphql-mcp"]: {
      transport: "stdio",
      command: "npx",
      args: [
        "-y",
        "mcp-remote@next",
        process.env.STEPZEN_ENDPOINT,
        "--header",
        `Authorization: apikey ${process.env.STEPZEN_APIKEY}`,
      ],
      // Restart configuration for stdio transport
      restart: {
        enabled: true,
        maxAttempts: 3,
        delayMs: 1000,
      },
    },
  },
});

export async function submitQuestion(messages) {
  // Create variable to store GraphQL schemas of MCP server(s)
  let graphqlExecutableSchema = "";

  try {
    // Get tools with custom configuration
    const mcpTools = await client.getTools();

    // Create and run the agent
    if (mcpTools.length === 0) {
      throw new Error("No tools found");
    }

    const tools = mcpTools.map((mcpTool) => {
      const schema = JSONSchemaToZod.convert(mcpTool.schema);

console.log('ZOD schema', JSON.stringify(schema))


      if (mcpTool.schema.properties?.query?.description) {
        graphqlExecutableSchema = `${graphqlExecutableSchema}
        
        Use the following GraphQL schema for "${mcpTool.name}":
        ${mcpTool.schema.properties?.query?.description}`;
      }

      return tool(mcpTool.func, {
        name: mcpTool.name,
        description: mcpTool.description,
        schema,
      });
    });

    // Create and run the agent
    const agent = createReactAgent({
      llm: model,
      tools
    });

    const agentResponse = await agent.invoke({
      messages: [
        { role: "system", content: graphqlExecutableSchema },
        ...messages,
      ],
    });

    console.log({ agentResponse });

    return (
      agentResponse?.messages[agentResponse?.messages.length - 1].content ||
      "Something went wrong"
    );
  } catch (e) {
    console.error({ e });
  } finally {
    // Clean up connection
    await client.close();
  }
}
