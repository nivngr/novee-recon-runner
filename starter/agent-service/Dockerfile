FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY main.go ./
RUN CGO_ENABLED=0 go build -trimpath -o /out/agent-service .

FROM gcr.io/distroless/static:nonroot
COPY --from=build /out/agent-service /agent-service
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/agent-service"]
