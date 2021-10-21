import { getMesh } from '@graphql-mesh/runtime';
import { parseWithCache } from '@graphql-mesh/utils';
import { RequestHandler } from 'express';
import { GraphQLError } from 'graphql';
import { getGraphQLParameters, processRequest, sendResult, shouldRenderGraphiQL } from 'graphql-helix';

function normalizeGraphQLError(error: GraphQLError) {
  return {
    ...error,
    extensions: error.extensions,
    locations: error.locations,
    message: error.message,
    name: error.name,
    nodes: error.nodes,
    originalError: {
      ...error?.originalError,
      name: error?.originalError?.name,
      message: error?.originalError?.message,
      stack: error?.originalError?.stack?.split('\n'),
    },
    path: error.path,
    positions: error.positions,
    source: {
      body: error.source?.body?.split('\n'),
      name: error.source?.name,
      locationOffset: {
        line: error.source?.locationOffset?.line,
        column: error.source?.locationOffset?.column,
      },
    },
    stack: error.stack?.split('\n'),
  };
}

export const graphqlHandler = (mesh$: ReturnType<typeof getMesh>): RequestHandler =>
  function (request, response, next) {
    // Determine whether we should render GraphiQL instead of returning an API response
    if (shouldRenderGraphiQL(request)) {
      next();
    } else {
      // Extract the GraphQL parameters from the request
      const { operationName, query, variables } = getGraphQLParameters(request);
      mesh$
        .then(({ schema, execute, subscribe }) =>
          processRequest({
            operationName,
            query,
            variables,
            request,
            schema,
            parse: parseWithCache,
            execute: (_schema, _documentAST, rootValue, contextValue, variableValues, operationName) =>
              execute(query, variableValues, contextValue, rootValue, operationName),
            subscribe: (_schema, _documentAST, rootValue, contextValue, variableValues, operationName) =>
              subscribe(query, variableValues, contextValue, rootValue, operationName),
            contextFactory: () => request,
          })
        )
        .then(result =>
          sendResult(result, response, (result: { data: any; errors: any[] }) => {
            result.errors = result.errors?.map(normalizeGraphQLError);
            return result;
          })
        )
        .catch((e: Error | AggregateError) => {
          response.status(500);
          response.write(
            JSON.stringify({
              errors:
                'errors' in e
                  ? e.errors.map((e: Error) => ({
                      name: e.name,
                      message: e.message,
                      stack: e.stack,
                    }))
                  : [
                      {
                        name: e.name,
                        message: e.message,
                        stack: e.stack,
                      },
                    ],
            })
          );
          response.end();
        });
    }
  };
