# Posts API Documentation

## Overview
This API provides complete social functionality for teacher posts including likes, comments, and replies with real teacher profiles.

## Base URL
`/api/posts`

## Authentication
All endpoints require JWT authentication. Include the token in the Authorization header:
`Authorization: Bearer <your-jwt-token>`

## Permissions
- **Teachers**: Can create, edit, delete posts, and can like/comment/reply on any post
- **Students**: Can only like, comment, and reply on posts (cannot create/edit/delete posts)

## Endpoints

### 1. Create a Post (Teachers Only)
**POST** `/api/posts/create`

**Request Body:**
- `content` (string, required): Post content
- `tags` (string, optional): Comma-separated tags

**Request Format:** `multipart/form-data`
- `content`: Text content
- `tags`: Tags (optional)
- `postImage`: Image file (optional, max 5MB, JPEG/PNG/GIF)

**Response:**
```json
{
  "success": true,
  "message": "Post created successfully",
  "data": {
    "id": "uuid",
    "author_email": "teacher@example.com",
    "author_name": "Teacher Name",
    "author_role": "Teacher",
    "author_profile_pic": "profile-image-url",
    "content": "Post content",
    "post_image": "image-url-or-null",
    "likes": 0,
    "created_at": "2024-01-01T00:00:00.000Z",
    "tags": ["tag1", "tag2"]
  }
}
```

### 2. Get All Posts
**GET** `/api/posts/all`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "author": {
        "email": "teacher@example.com",
        "name": "Teacher Name",
        "role": "Teacher",
        "profile_pic": "profile-image-url"
      },
      "content": "Post content",
      "postImage": "image-url-or-null",
      "likes": 5,
      "createdAt": "2024-01-01T00:00:00.000Z",
      "tags": ["tag1", "tag2"]
    }
  ]
}
```

### 3. Get Single Post
**GET** `/api/posts/:postId`

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "author": {
      "email": "teacher@example.com",
      "name": "Teacher Name",
      "role": "Teacher",
      "profile_pic": "profile-image-url"
    },
    "content": "Post content",
    "postImage": "image-url-or-null",
    "likes": 5,
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z",
    "tags": ["tag1", "tag2"]
  }
}
```

### 4. Edit Post (Author Only)
**PUT** `/api/posts/:postId`

**Request Body:**
- `content` (string, required): Updated post content
- `tags` (string, optional): Updated comma-separated tags

**Request Format:** `multipart/form-data`
- `content`: Updated text content
- `tags`: Updated tags (optional)
- `postImage`: New image file (optional)

**Response:**
```json
{
  "success": true,
  "message": "Post updated successfully"
}
```

### 5. Delete Post (Author Only)
**DELETE** `/api/posts/:postId`

**Response:**
```json
{
  "success": true,
  "message": "Post deleted successfully"
}
```

### 6. Like/Unlike Post
**POST** `/api/posts/:postId/like` - Like a post
**DELETE** `/api/posts/:postId/like` - Unlike a post

**Response:**
```json
{
  "success": true,
  "message": "Post liked successfully"
}
```

### 7. Get Post Comments
**GET** `/api/posts/:postId/comments`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "author": {
        "email": "user@example.com",
        "name": "User Name",
        "role": "Student/Teacher",
        "profile_pic": "profile-image-url"
      },
      "content": "Comment content",
      "likes": 3,
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

### 8. Add Comment to Post
**POST** `/api/posts/:postId/comments`

**Request Body:**
```json
{
  "content": "Comment content"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Comment added successfully",
  "data": {
    "id": "uuid",
    "post_id": "post-uuid",
    "author": {
      "email": "user@example.com",
      "name": "User Name",
      "role": "Student/Teacher",
      "profile_pic": "profile-image-url"
    },
    "content": "Comment content",
    "likes": 0,
    "created_at": "2024-01-01T00:00:00.000Z"
  }
}
```

### 9. Like/Unlike Comment
**POST** `/api/posts/comments/:commentId/like` - Like a comment
**DELETE** `/api/posts/comments/:commentId/like` - Unlike a comment

**Response:**
```json
{
  "success": true,
  "message": "Comment liked successfully"
}
```

### 10. Get Comment Replies
**GET** `/api/posts/comments/:commentId/replies`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "author": {
        "email": "user@example.com",
        "name": "User Name",
        "role": "Student/Teacher",
        "profile_pic": "profile-image-url"
      },
      "content": "Reply content",
      "likes": 2,
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

### 11. Add Reply to Comment
**POST** `/api/posts/comments/:commentId/replies`

**Request Body:**
```json
{
  "content": "Reply content"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Reply added successfully",
  "data": {
    "id": "uuid",
    "comment_id": "comment-uuid",
    "post_id": "post-uuid",
    "author": {
      "email": "user@example.com",
      "name": "User Name",
      "role": "Student/Teacher",
      "profile_pic": "profile-image-url"
    },
    "content": "Reply content",
    "likes": 0,
    "created_at": "2024-01-01T00:00:00.000Z"
  }
}
```

### 12. Like/Unlike Reply
**POST** `/api/posts/replies/:replyId/like` - Like a reply
**DELETE** `/api/posts/replies/:replyId/like` - Unlike a reply

**Response:**
```json
{
  "success": true,
  "message": "Reply liked successfully"
}
```

## Error Responses

### 400 Bad Request
```json
{
  "success": false,
  "message": "Content is required"
}
```

### 401 Unauthorized
```json
{
  "success": false,
  "message": "No token provided"
}
```

### 403 Forbidden
```json
{
  "success": false,
  "message": "Only teachers can create posts"
}
```

### 404 Not Found
```json
{
  "success": false,
  "message": "Post not found"
}
```

### 500 Internal Server Error
```json
{
  "success": false,
  "message": "Failed to create post"
}
```

## Database Schema

### Posts Table
- `id` (UUID, PRIMARY KEY)
- `author_email` (TEXT)
- `author_name` (TEXT)
- `author_role` (TEXT)
- `author_profile_pic` (TEXT)
- `content` (TEXT)
- `post_image` (TEXT)
- `likes_counter` (COUNTER)
- `created_at` (TIMESTAMP)
- `updated_at` (TIMESTAMP)
- `tags` (SET<TEXT>)

### Post Likes Table
- `post_id` (UUID)
- `user_email` (TEXT)
- `liked_at` (TIMESTAMP)
- PRIMARY KEY: (post_id, user_email)

### Post Comments Table
- `id` (UUID, PRIMARY KEY)
- `post_id` (UUID)
- `author_email` (TEXT)
- `author_name` (TEXT)
- `author_role` (TEXT)
- `author_profile_pic` (TEXT)
- `content` (TEXT)
- `likes_counter` (COUNTER)
- `created_at` (TIMESTAMP)
- `updated_at` (TIMESTAMP)

### Comment Likes Table
- `comment_id` (UUID)
- `user_email` (TEXT)
- `liked_at` (TIMESTAMP)
- PRIMARY KEY: (comment_id, user_email)

### Comment Replies Table
- `id` (UUID, PRIMARY KEY)
- `comment_id` (UUID)
- `post_id` (UUID)
- `author_email` (TEXT)
- `author_name` (TEXT)
- `author_role` (TEXT)
- `author_profile_pic` (TEXT)
- `content` (TEXT)
- `likes_counter` (COUNTER)
- `created_at` (TIMESTAMP)
- `updated_at` (TIMESTAMP)

### Reply Likes Table
- `reply_id` (UUID)
- `user_email` (TEXT)
- `liked_at` (TIMESTAMP)
- PRIMARY KEY: (reply_id, user_email)

## Testing Examples

### Create a Post (Teacher)
```bash
curl -X POST http://localhost:3000/api/posts/create \
  -H "Authorization: Bearer <teacher-jwt-token>" \
  -F "content=This is my first post!" \
  -F "tags=education,mathematics" \
  -F "postImage=@/path/to/image.jpg"
```

### Get All Posts
```bash
curl -X GET http://localhost:3000/api/posts/all \
  -H "Authorization: Bearer <jwt-token>"
```

### Add Comment (Student/Teacher)
```bash
curl -X POST http://localhost:3000/api/posts/<post-id>/comments \
  -H "Authorization: Bearer <jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{"content": "Great post!"}'
```

### Like a Post
```bash
curl -X POST http://localhost:3000/api/posts/<post-id>/like \
  -H "Authorization: Bearer <jwt-token>"
```

## Features Implemented

✅ **Complete Social Functionality:**
- Teachers can create posts with images and tags
- Both teachers and students can like posts
- Both teachers and students can comment on posts
- Both teachers and students can reply to comments
- Likes on comments and replies

✅ **Real Teacher Profiles:**
- Automatic fetching of teacher profile data
- Profile pictures and names from database
- Student profiles also supported

✅ **Permission Controls:**
- Only teachers can create/edit/delete posts
- Students can only interact (like/comment/reply)
- Author-only edit/delete permissions

✅ **Production Ready:**
- Comprehensive error handling
- Input validation
- File upload support with size limits
- Database constraints and indexes
- Proper HTTP status codes

✅ **Data Integrity:**
- Cascade deletion for related data
- Counter-based like tracking
- Timestamps for all operations
- UUID-based primary keys

## Notes
- All timestamps are in UTC
- Image uploads are limited to 5MB
- Supported image formats: JPEG, PNG, GIF
- Database uses Cassandra with proper consistency
- All operations are atomic and transactional
