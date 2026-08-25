FROM node:20.19.1-bookworm AS front
WORKDIR /app
RUN npm install -g pnpm@10.10.0
COPY front/package.json .
COPY front/pnpm-lock.yaml .
COPY front/pnpm-workspace.yaml .
RUN pnpm install
COPY front/. .
RUN pnpm run build

FROM golang:1.23.3-alpine AS backend
ARG VERSION
ARG COMMIT_ID
WORKDIR /app
RUN apk add --no-cache build-base tzdata
COPY backend/go.mod .
COPY backend/go.sum .
RUN go mod download
COPY backend/. .
COPY --from=front /app/dist /app/public
RUN go build -tags prod -ldflags="-s -w -X main.mode=prod -X main.version=${VERSION} -X main.commitId=${COMMIT_ID}" -o /app/songlist

FROM alpine
WORKDIR /app/data
RUN apk update --no-cache && apk add --no-cache ca-certificates tzdata
ENV PORT=3000
ENV TZ=Asia/Shanghai
COPY --from=backend /app/songlist /app/songlist
RUN chmod +x /app/songlist
EXPOSE 3000
CMD ["/app/songlist"]
