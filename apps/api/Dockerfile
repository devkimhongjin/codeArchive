FROM eclipse-temurin:17-jdk-jammy AS build
WORKDIR /workspace

COPY .mvn .mvn
COPY mvnw pom.xml ./
RUN chmod +x mvnw && ./mvnw -B -ntp dependency:go-offline

COPY src src
RUN ./mvnw -B -ntp package -DskipTests

FROM eclipse-temurin:17-jre-jammy AS runtime
RUN groupadd --system --gid 10001 codearchive \
    && useradd --system --uid 10001 --gid codearchive --create-home codearchive
WORKDIR /app
COPY --from=build /workspace/target/codearchive-api-0.0.1-SNAPSHOT.jar /app/app.jar
USER codearchive:codearchive

EXPOSE 8080
ENTRYPOINT ["sh", "-c", "exec java -Dserver.port=${PORT:-8080} -jar /app/app.jar"]
