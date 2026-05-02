# Architecture

## Overview

This document describes the system architecture.

## Components

The system has three main components: the API server, the database layer, and the frontend.

## Database

We use PostgreSQL for persistent storage with Redis for caching.

## API

The REST API is built with Express and handles authentication via JWT tokens.
