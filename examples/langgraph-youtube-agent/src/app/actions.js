"use server";

import { ChatOllama } from "@langchain/ollama";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export async function transcribe(videoUrl) {
  if (!process.env.STEPZEN_ENDPOINT || !process.env.STEPZEN_APIKEY) {
    console.log("Something went wrong");
    return null;
  }

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

  // Get tools with custom configuration
  const mcpTools = await client.getTools();

  // Create and run the agent
  if (mcpTools.length === 0) {
    throw new Error("No tools found");
  }

  // Find transcript tool
  const transcriptMCPTool = mcpTools.find((mcpTool) =>
    mcpTool?.name?.endsWith("youtube_transcript")
  );

  if (!transcriptMCPTool) {
    throw new Error("No youtube_transcript tool found");
  }

  // Create the LangChain tool definition
  const transcriptTool = tool(transcriptMCPTool.func, {
    name: transcriptMCPTool.name,
    description: transcriptMCPTool.description,
    schema: z.object({
      query: z
        .string()
        .describe(
          'This is a GraphQL tool. Use the schema supplied in the query property to define the correct GraphQL request. The query parameter must be a valid GraphQL executable document that looks like this: query { transcript(videoUrl: "https://www.youtube.com/watch?v=VIDEO_ID", langCode: "en") { title captions { text start dur } } }'
        ),
    }),
  });

  // Set the structured response format
  const responseFormat = z.object({
    videoId: z.string().describe("ID of the video"),
    title: z.string().describe("Title of the video"),
    description: z.string().describe("Description of the video"),
    captions: z.string().describe("Captions for the video transcript"),
  });

  const responseFormatJSON = zodToJsonSchema(responseFormat, "responseFormat");

  const agent = createReactAgent({
    llm: new ChatOllama({
      model: "llama3.2",
      temperature: 0,
      format: responseFormatJSON,
    }),
    tools: [transcriptTool],
  });

  const response = await agent.invoke({
    messages: [
      new SystemMessage(`
            You're a YouTube transcription agent.
        
            You should retrieve the video id for a given YouTube url and return the title and description of the video. 
            Also retrieve the transcript for the youtube video using the transcript tool.
            Use all tools at your disposal.

            Generate the description by summarizing the transcript.
        `),
      new HumanMessage(`Here is the YouTube URL: ${videoUrl}.`),
    ],
  });

  return response.messages[response.messages.length - 1].content;
}
